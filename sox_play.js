/**
 * Copyright 2020 Johannes Kropf
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
module.exports = function(RED) {

    const { spawn } = require("child_process");
    const { exec } = require("child_process");
    const fs = require("fs");
    
    function SoxPlayNode(config) {
        RED.nodes.createNode(this,config);
        this.statusTimer = false;
        this.statusTimer2 = false;
        this.outputDeviceRaw = config.outputDevice;
        this.outputDevice = "hw:";
        this.gain = config.gain;
        this.debugOutput = config.debugOutput;
        this.argArr = [];
        this.startNew = config.startNew;
        this.killNew = false;
        this.newPayload = "";
        this.queue = [];
        this.playingNow;
        this.fileId = "";
        this.filePath = "";
        this.shm = true;
        var node = this;
        
        function node_status(state1 = [], timeout = 0, state2 = []){
            
            if (state1.length !== 0) {
                node.status({fill:state1[1],shape:state1[2],text:state1[0]});
            } else {
                node.status({});
            }
            
            if (node.statusTimer !== false) {
                clearTimeout(node.statusTimer);
                node.statusTimer = false;
            }
            
            if (timeout !== 0) {
                node.statusTimer = setTimeout(() => {
                
                    if (state2.length !== 0) {
                        node.status({fill:state2[1],shape:state2[2],text:state2[0]});
                    } else {
                        node.status({});
                    }
                    
                    node.statusTimer = false;
                    
                },timeout);
            }
            
        }
        
        function playQueue(){
            
            let queueItem = node.queue.shift();
            node.argArr = [];
            if (!node.debugOutput) { node.argArr.push('-q'); }
            node.argArr.push(queueItem.trim(),'-t','alsa',node.outputDevice,'gain',node.gain);
            spawnPlay();
            return;
            
        }
        
        function spawnPlay(){
            
            try{
                node.soxPlay = spawn("sox",node.argArr);
            } 
            catch (error) {
                node_status(["error starting play command","red","ring"],1500);
                node.error(error);
                return;
            }
            
            if (node.queue.length === 0) {
                node_status(["playing","blue","dot"]);
            } else {
                node_status(["playing | " + node.queue.length + " in queue","blue","dot"]);
            }
            
            node.soxPlay.stderr.on('data', (data)=>{
            
                node.send({payload:data.toString()});
                
            });
            
            node.soxPlay.on('close', function (code,signal) {
                
                node.send({payload:"complete"});
                node_status(["finished","green","dot"],1500);
                delete node.soxPlay;
                if (node.queue.length !== 0) {
                    playQueue();
                } else if (!node.killNew) {
                    node.argArr = [];
                    if (!node.debugOutput) { node.argArr.push('-q'); }
                } else {
                    node.killNew = false;
                    spawnPlay();
                }
                return;
                
            });
            
            node.soxPlay.stdout.on('data', (data)=>{
                
            });
            return;
        
        }
        
        node_status();
        
        node.fileId = node.id.replace(/\./g,"");
        
        if (!fs.existsSync('/dev/shm')) { node.shm = false; }
        
        if (node.outputDeviceRaw === 'default') {
            node.outputDevice = node.outputDeviceRaw;
        } else {
            node.outputDevice += node.outputDeviceRaw.toString();
        }
        
        if (!node.debugOutput) { node.argArr.push('-q'); }
        
        node.on('input', function(msg) {
            
            if (Buffer.isBuffer(msg.payload) && msg.payload.length === 0) { node.error("empty buffer"); node_status(["error","red","dot"],1500); return; }
            
            if (msg.payload === 'stop' && node.soxPlay) {
                node.queue = [];
                node.soxPlay.kill();
            } else if (msg.payload === 'stop' && !node.soxPlay) {
                node.warn('not playing');
            } else if (msg.payload === 'clear' && node.queue.length !== 0) {
                node.queue = [];
                node.send({payload:'queue cleared'});
                node_status(["playing","blue","dot"]);
            } else if (msg.payload === 'clear' && node.queue.length === 0) {
                node.warn('queue is already empty');
            } else if (msg.payload === 'next' && node.queue.length !== 0) {
                node.soxPlay.kill();
            } else if (msg.payload === 'next' && node.queue.length === 0) {
                node.warn('no other items in the queue');
            } else if (!node.soxPlay && typeof msg.payload === 'string') {
                node.argArr.push(msg.payload.trim(),'-t','alsa',node.outputDevice,'gain',node.gain);
                spawnPlay();
            } else if (!node.soxPlay && Buffer.isBuffer(msg.payload)) {
                if (!msg.hasOwnProperty("format")) { node.error("msg with a buffer payload also needs to have a coresponding msg.format property"); node_status(["error","red","dot"],1500); return; }
                node.filePath = (node.shm) ? "/dev/shm/" + node.fileId + "." + msg.format : "/tmp/" + node.fileId + "." + msg.format;
                try {
                    fs.writeFileSync(node.filePath, msg.payload);
                } catch (error) {
                    node.error("couldnt write tmp file");
                }
                node.argArr.push(node.filePath,'-t','alsa',node.outputDevice,'gain',node.gain);
                spawnPlay();
            } else if (node.soxPlay && node.startNew === 'start') {
                node.argArr = [];
                if (!node.debugOutput) { node.argArr.push('-q'); }
                if (typeof msg.payload === 'string') {
                    node.argArr.push(msg.payload.trim(),'-t','alsa',node.outputDevice,'gain',node.gain);
                } else if (Buffer.isBuffer(msg.payload)) {
                    if (!msg.hasOwnProperty("format")) { node.error("msg with a buffer payload also needs to have a coresponding msg.format property"); node_status(["error","red","dot"],1500); return; }
                    node.filePath = (node.shm) ? "/dev/shm/" + node.fileId + "new." + msg.format : "/tmp/" + node.fileId + "new." + msg.format;
                    try {
                        fs.writeFileSync(node.filePath, msg.payload);
                    } catch (error) {
                        node.error("couldnt write tmp file");
                    }
                    node.argArr.push(node.filePath,'-t','alsa',node.outputDevice,'gain',node.gain);
                }
                node.newPayload = msg.payload;
                node.killNew = true;
                node.soxPlay.kill();
            } else if (node.soxPlay && node.startNew === 'queue') {
                if (Buffer.isBuffer(msg.payload)) {
                    if (!msg.hasOwnProperty("format")) { node.error("msg with a buffer payload also needs to have a coresponding msg.format property"); node_status(["error","red","dot"],1500); return; }
                    node.filePath = (node.shm) ? "/dev/shm/" + node.fileId + node.queue.length + "." + msg.format : "/tmp/" + node.fileId + node.queue.length + "." + msg.format;
                    try {
                        fs.writeFileSync(node.filePath, msg.payload);
                    } catch (error) {
                        node.error("couldnt write tmp file");
                    }
                    node.queue.push(node.filePath);
                } else {
                    node.queue.push(msg.payload);
                }
                if (node.queue.length === 1) {
                    node.send({payload:'added to queue. There is now ' + node.queue.length + ' file in the queue.' })
                } else {
                    node.send({payload:'added to queue. There is now ' + node.queue.length + ' files in the queue.' })
                }
                node_status(["playing | " + node.queue.length + " in queue","blue","dot"]);
            } else {
                node.warn('ignoring input as there is already a playback in progress');
            }
            
        });
        
        node.on("close",function() {
        
            node_status();
            
            node.queue = [];
            
            const checkDir = (node.shm) ? "/dev/shm/" : "/tmp/";
            fs.readdir(checkDir, (err,files) => {
                if (err) { node.error("couldnt check for leftovers in " + checkDir); return; }
                files.forEach(file => {
                    if (file.match(node.fileId)) {
                        try {
                            fs.unlinkSync(checkDir + file);
                        } catch (error) {
                            node.error("couldnt delete leftover " + file);
                        }
                    }
                });
                return;
            });
            
            if(node.soxPlay) {
                node.soxPlay.kill();
                
            }
            
        });
        
    }
    RED.nodes.registerType("sox-play",SoxPlayNode);

    RED.httpAdmin.get("/soxPlay/devices", RED.auth.needsPermission('sox-play.read'), function(req,res) {
        exec('aplay -l', (error, stdout, stderr) => {
            if (error) {
                node.error(`exec error: ${error}`);
                return;
            }
            if (stderr) { node.error(`stderr: ${stderr}`); }
            if (stdout) {
                let deviceArr = stdout.split("\n");
                deviceArr = deviceArr.filter(line => line.match(/card/g));
                deviceArr = deviceArr.map(device => {
                    let deviceObj = {};
                    deviceObj.name = device.replace(/\s\[[^\[\]]*\]/g, "");
                    deviceObj.number = device.match(/[0-9](?=\:)/g);
                    return deviceObj;
                });
                res.json(deviceArr);
            }
        });
    });
}