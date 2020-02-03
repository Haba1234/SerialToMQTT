/* 
 * File:   index.js
 * Author: Haba1234
 *
 * 02/03/2020
 */

'use strict';

const SerialPort = require('serialport');
const MQTT = require('mqtt');
const InterByteTimeout = require('@serialport/parser-inter-byte-timeout');
const setup = require('./setup');
const mqttClient = MQTT.connect(setup.mqtt);

var currentDevice = 0;
var countDevice = 0;

let devices = [];
let stackCMD = [];

const serial = new SerialPort(setup.port, {baudRate: setup.rate}, function (err) {
	if (err) {
		return console.error('Error: ', err.message)
	}
	ReadStates(setup.timer_read_states);
});

// MQTT subscriber (MQTT --> serial)
mqttClient.on('connect', function () {

	countDevice = setup.devices.length - 1; // кол-во устройств
	console.log("countDevice = " + (countDevice + 1));
	
	for (let i = 0; i <= countDevice; i++) {
		for(let key in setup.devices[i]){
			devices.push({name : key, 
					addr: setup.devices[i][key], 
					state: [0, 0, 0, 0, 0, 0, 0, 0],
					cmd: [0, 0, 0, 0, 0, 0, 0, 0]
					});
			// подписываемся на топики
			for (let j = 1; j <= 8; j++) {
				mqttClient.subscribe("/devices/" + key + "/controls/CH" + j + "/on");
			}
		}
	}
});

mqttClient.on('message', function (topic, message) {
	let addrDevice = 0x80;
	let mask = 0x01;
	let command = 0x00;
	let relay = 0;
	let value = message.readUInt8(0); // вытаскиваем из буфера значение. И проверяем пришло числом или символом
	
	if (value > 2) value = value - 48;
	let data = parseTopicMQTT(topic);
	for (var k = 0; k < countDevice; k++) {
		if (devices[k].name === data[0]){
			// проверяем, что команда не совпадает с состоянием
			relay = data[1]-1;
			if (devices[k].state[relay] == value){ 
			} else {
				deleteCMDstack(addrDevice);
				if (relay > 3) {mask = mask << (relay - 4);}
					else mask = mask << (relay);
	
				if (value != 0) command = mask;
				addrDevice = devices[k].addr | 0x80;
				
				if (relay > 3) stackCMD.unshift(Buffer.from([addrDevice, 0x01, mask, 0x00, command, 0x00]));
					else stackCMD.unshift(Buffer.from([addrDevice, 0x01, 0x00, mask, 0x00, command]));
				// обновляем данные по устройству
				devices[k].state[relay] = value;
				devices[k].cmd[relay] = value;
			} 
		}
	}
});

// удаление из стека команд считывания состояний, если пришла команда
function deleteCMDstack(addrDevice){
	let element = Buffer.from([addrDevice, 0x03]);
	let idx = stackCMD.indexOf(element);

	while (idx != -1) {
	  indices.push(idx);
	  let removed = myFish.splice(idx, 1);
	  idx = stackCMD.indexOf(element, idx + 1);
	}
}

// разбирает топик на запчасти и возвращает массивом имя устройства и номер реле
function parseTopicMQTT(topic){
	let arr = topic.split('/');
	let numRelay = arr[4];
	let name = arr[2];
	numRelay = parseInt(numRelay.slice(2, 3), 10);
	let result = [name, numRelay];
	
	return result;
}

// ------- фоновая функция опроса состояний ---
function ReadStates(timer){
	let addrDevice = 0x80;
	
	let timerId = setTimeout(function tick() {
		for(var key in setup.devices[currentDevice])
			addrDevice = setup.devices[currentDevice][key] | 0x80;
		
		if (stackCMD.length <= 0){
			stackCMD.unshift(Buffer.from([addrDevice, 0x03]));
			currentDevice += 1;
		}
		if (currentDevice > countDevice) currentDevice = 0;
		timerId = setTimeout(tick, timer);
	}, timer);
}

// ------- фоновая функция записи в порт из стека ---
let timerId2 = setTimeout(function tickWrite() {
	if (stackCMD.length > 0){
		let cmd = stackCMD.pop();
		serialWrite(cmd);
	}
	timerId2 = setTimeout(tickWrite, setup.timer_write_port);
}, setup.timer_write_port);


function serialWrite(buff){
	serial.write(buff, function(err) { //String.fromCharCode
		if (err) {
			return console.error('Error on write: ', err.message);
		}
	});
}

const parser = serial.pipe(new InterByteTimeout({interval: 30}))
// получаем состояние устройства
parser.on('data', (data) => {
	parserDataDevice(data);
});

function parserDataDevice(data){
	let addr = data[0] ^ 0x80; // адрес устройства
	let value;
	if (data[1] == 0x43) {
		for (let i = 0; i < countDevice; i++) {
			if (devices[i].addr == addr) {
				if (stackCMD.length <= 0){
					for (let j = 0; j < 4; j++) {
						value = (data[3] >> j) & 0x01; //получаем состояние необходимого реле
						if (value != devices[i].state[j]){
							devices[i].state[j] = value;
							devices[i].cmd[j] = value;
							mqttClient.publish("/devices/" + devices[i].name + "/controls/CH" + (j + 1), value.toString(), {qos: setup.qos});
						}
						
						value = (data[2] >> j) & 0x01; //получаем состояние необходимого реле
						if (value != devices[i].state[j+4]){ 
							devices[i].state[j+4] = value;
							devices[i].cmd[j+4] = value;
							mqttClient.publish("/devices/" + devices[i].name + "/controls/CH" + (j + 5), value.toString(), {qos: setup.qos});
						}
					} 
				}
			}	
		}
	} else if (data[1] == 0x41) {/*console.log("Команда выполнена!")*/}
	//else console.error("Неправильный код функции!!!");
}