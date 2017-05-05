const fs = require('fs');
const request = require('request');
const url = require("url");
const path = require("path");
const mkdirp = require('mkdirp');
const async = require('async');

function read7BitEncodedInt(data)
{
	let num = 0;
	let num2 = 0;
	let i = 0;
	for (i = 0; i < 5; i++)
	{
		let b = data[i];
		num |= ((b & 127) << num2);
		num2 += 7;
		if ((b & 128) == 0)
		{
			break;
		}
	}
	if (i < 5)
	{
		return [num, i + 1];
	}
	console.log('error');
	return [0, 0];
}

function readString(data)
{
	const [num, inc] = read7BitEncodedInt(data);
	let resultString = "";
	if (num != 0)
	{
		return [data.toString('utf8', inc, inc + num), inc + num];
	}
	
	return [resultString, inc];
}

function getTextureUrlList()
{
	return new Promise((resolve, reject) => {
		fs.readFile('utage.list', function(err, data) {
			let resultList = [];
			
			const num3 = data.readInt32LE(8);
			let index = 12;
			for(let i = 0; i < num3; i++)
			{
				const [directoryName, inc] = readString(data.slice(index));
				index += inc;
				
				index += 4;
				const fileAmount = data.readInt32LE(index);
				index += 4;
				
				// read file
				for(let fileIndex = 0; fileIndex < fileAmount; fileIndex++)
				{
					index += 4; // 0 check
					const [fileName, fileNameLength] = readString(data.slice(index));
					index += fileNameLength;
					index += 4; // version
					const [hash, hashLength] = readString(data.slice(index));
					index += hashLength;
					
					// AllDependencies
					const allDependenciesAmount = data.readInt32LE(index);
					index += 4;
					
					for (let j = 0; j < allDependenciesAmount; j++)
					{
						const [allDependency, allDependencyLength] = readString(data.slice(index));
						index += allDependencyLength;
					}
					
					// DirectDependencies
					const directDependenciesAmount = data.readInt32LE(index);
					index += 4;
					
					for (let j = 0; j < directDependenciesAmount; j++)
					{
						const [directDependency, directDependencyLength] = readString(data.slice(index));
						index += directDependencyLength;
					}
					
					if (directoryName == "Resouces")
					{
						resultList.push(`http://cdn.housamo.jp/housamo/utage/${fileName}.utage`);
					}
				}
			}
			
			resolve(resultList);
		});	
	});
}

function decrypt(data)
{
	const key = "InputOriginalKey";
	const outputBuffer = new Buffer(data.length);
	for (let i = 0; i != data.length; i++)
	{
		if (data[i] == 0)
		{
			outputBuffer[i] = 0;
		}
		else
		{
			outputBuffer[i] = key.charCodeAt(i % key.length) ^ data[i];
			if (outputBuffer[i] == 0)
			{
				outputBuffer[i] = data[i];
			}
		}
	}
	
	return outputBuffer;
}

function decryptUtage()
{
	return new Promise((resolve, reject) => {
		fs.readFile('utage.list.bytes.utage', function(err, data) {
			const outputBuffer = decrypt(data);

			const ws = fs.createWriteStream('utage.list.bytes');
			ws.write(outputBuffer);
			ws.end();
			
			resolve();
		});
	});
}

function decompress(data)
{
	const size = data.readInt32LE(0);
	const outputBuffer = new Buffer(size);
	let index = 0;
	for (let i = 4; i < data.length; i++)
	{
		let num3 = 0;
		if ((data[i] & 128) != 0)
		{
			num3 = data[i] & 15;
			num3 += 3;
			let num4 = (data[i] & 112) << 4 | data[i+1];
			num4++;
			
			for (let j = 0; j < num3; j++)
			{
				outputBuffer[index + j] = outputBuffer[index - num4 + j];
			}
			i++;
		}
		else
		{
			num3 = data[i] + 1;
			for (let j = 0; j < num3; j++)
			{
				outputBuffer[index + j] = data[i + 1 + j];
			}
			i += num3;
		}
		index += num3;
	}
	
	return outputBuffer;
}

function decompressUtage(fileName)
{
	return new Promise((resolve, reject) => {
		fs.readFile('utage.list.bytes', function(err, data) {
			const outputBuffer = decompress(data);
			
			const ws = fs.createWriteStream('utage.list');
			ws.write(outputBuffer);
			ws.end();
			
			resolve();
		});
	});
}

function downloadTextures(uri, callback)
{
	request({
		uri: uri,
		encoding: null
	}, function (err, res, body) {
		const buffer = res.body;
		const pngBuffer = decrypt(buffer);
		
		const fileNameWithUtage = path.basename(url.parse(uri).pathname);
		const fileName = fileNameWithUtage.substr(0, fileNameWithUtage.indexOf('.utage'));

		const ws = fs.createWriteStream(`output/${fileName}`);
		ws.write(pngBuffer);
		ws.end();
		
		callback();
	});
}

mkdirp('output', function(err) {
	request('http://cdn.housamo.jp/housamo/utage/utage.list.bytes.utage')
		.pipe(fs.createWriteStream('utage.list.bytes.utage'))
		.on('close', function() {
			decryptUtage()
				.then(decompressUtage)
				.then(getTextureUrlList)
				.then(function(urlList) {
					const queue = async.queue(downloadTextures, 5);
					queue.drain = function() {
						console.log('Finished!!');
					};

					urlList.forEach((uri) => {
						queue.push(uri);
					});
				});
		});
});