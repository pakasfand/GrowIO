import { Scene } from "phaser";
import config from './config.js';

export class MainScene extends Scene {
    constructor() {
        super({ key: "MainScene" });
    }
    
    create() {
        this.worldSize = new Phaser.Math.Vector2(5000, 5000);

        // Draw grid lines
        const gridSize = 100; // Size of each grid cell
        const gridGraphics = this.add.graphics();
        gridGraphics.lineStyle(1, 0x444444, 0.5); // Gray lines, semi-transparent

        // Vertical lines
        for (let x = 0; x <= this.worldSize.x; x += gridSize) {
            gridGraphics.beginPath();
            gridGraphics.moveTo(x, 0);
            gridGraphics.lineTo(x, this.worldSize.y);
            gridGraphics.strokePath();
        }

        // Horizontal lines
        for (let y = 0; y <= this.worldSize.y; y += gridSize) {
            gridGraphics.beginPath();
            gridGraphics.moveTo(0, y);
            gridGraphics.lineTo(this.worldSize.x, y);
            gridGraphics.strokePath();
        }
        gridGraphics.setDepth(-1); // Ensure grid is behind everything
        
        this.cameras.main.setBackgroundColor('#ffffff');
        
        // Create a UI container for all UI text
        this.uiContainer = this.add.container(0, 0);

        // HTML overlay elements
        this.fpsOverlay = document.getElementById('fps-overlay');
        this.usernameOverlay = document.getElementById('username-overlay');
        this.splitIndicatorOverlay = document.getElementById('split-indicator-overlay');
        this.leaderboardOverlay = document.getElementById('leaderboard-overlay');

        // Use configuration for server connection
        this.socket = new WebSocket(config.serverUrl);
        this.playerId;
        this.cells = {};
        this.cellIds = new Set();

        this.pickUps = {};
        this.pickUpIds = new Set();

        // Send username with connection
        this.socket.addEventListener('open', () => {
            const username = window.playerUsername || this.defaultPlayerUsername;
            this.socket.send(JSON.stringify({
                type: 'connect',
                username: username
            }));
            if (this.usernameOverlay) {
                this.usernameOverlay.textContent = `Playing as: ${username}`;
            }
        });

        this.socket.addEventListener('message', (event) => {
            const msg = JSON.parse(event.data);

            if (msg.type === 'init') {
                this.playerId = msg.playerId;
                console.log(`Connected as ${this.playerId}`);

                const allCellData = this.getAllCellsById(msg.allPlayerData);
                for (const [cellId, cellData] of Object.entries(allCellData)) {
                    const playerUsername = msg.allPlayerData[cellData.ownerPlayerId]?.username || this.defaultPlayerUsername;
                    this.cells[cellData.id] = this.initCell(cellData, playerUsername);
                }

                this.cellIds = new Set(Object.keys(allCellData));
                
                // Set camera bounds
                this.cameras.main.setBounds(0, 0, this.worldSize.x, this.worldSize.y);
                
                // Set player username
                if (this.usernameOverlay) {
                    const playerUsername = window.playerUsername || this.defaultPlayerUsername;
                    this.usernameOverlay.textContent = `Playing as: ${playerUsername}`;
                }
            }

            if (msg.type === 'state') {
                
                // Synchronize cells
                const allCellData = this.getAllCellsById(msg.allPlayerData);
                const stateCellIds = new Set(Object.keys(allCellData));
                const cellIdsToSpawn = stateCellIds.difference(this.cellIds);
                const cellIdsToRemove = this.cellIds.difference(stateCellIds);
                this.cellIds = stateCellIds;

                for (const cellId of cellIdsToSpawn) {
                    let cellData = allCellData[cellId];
                    const playerUsername = msg.allPlayerData[cellData.ownerPlayerId]?.username || this.defaultPlayerUsername;
                    this.cells[cellId] = this.initCell(allCellData[cellId], playerUsername);
                }

                for (const cellId of cellIdsToRemove) {
                    if (this.cells[cellId] && this.cells[cellId].container) {
                        this.cells[cellId].container.first.destroy();
                        this.cells[cellId].container.destroy();
                    }
                    delete this.cells[cellId];
                    console.log(`Removing cell with if ${cellId}`)
                }
                
                // Update cell properties
                for(const cellId of stateCellIds)
                {
                    const cellData = allCellData[cellId];
                    const cell = this.cells[cellId];

                    cell.lastX = cell.x;
                    cell.lastY = cell.y;

                    cell.x = cellData.x;
                    cell.y = cellData.y;
                    
                    cell.lerpAlpha = 0;
                    
                    // Update cell visual as cell has grown
                    if (cell.radius !== cellData.radius) {
                        cell.radius = cellData.radius;
                        const graphics = cell.container.first;
                        if (graphics) {
                            graphics.clear();
                            graphics.fillStyle(cell.color, 1);
                            graphics.fillCircle(0, 0, cell.radius);
                        }

                        const cellOutline = cell.container.getAt(1);
                        if (cellOutline) {
                            cellOutline.clear();
                            cellOutline.lineStyle(1, 0x000000, 1);
                            cellOutline.strokeCircle(0, 0, cell.radius);
                        }
                        
                        // Update username position when cell grows
                        const usernameText = cell.container.getAt(2);
                        if (usernameText) {
                            usernameText.setPosition(0, -cell.radius - 15);
                        }
                    }
                }
                
                // Check if any player cell is big enough to split
                const playerCells = Object.values(allCellData).filter(cellData => cellData.ownerPlayerId === this.playerId);
                const canSplit = playerCells.some(s => s.radius >= 35); // Match server's MIN_SPLIT_RADIUS
                if (this.splitIndicatorOverlay) {
                    this.splitIndicatorOverlay.style.display = canSplit ? 'block' : 'none';
                }
                
                // Synchronize pickups
                const statePickUpIds = new Set(Object.keys(msg.pickUps));
                const pickUpsIdsToSpawn = statePickUpIds.difference(this.pickUpIds);
                const pickUpsIdsToRemove = this.pickUpIds.difference(statePickUpIds);
                this.pickUpIds = statePickUpIds;

                for (const pickUpId of pickUpsIdsToSpawn) {
                    this.pickUps[pickUpId] = this.initPickUp(msg.pickUps[pickUpId]);
                }

                for (const pickUpId of pickUpsIdsToRemove) {
                    if (this.pickUps[pickUpId] && this.pickUps[pickUpId].container) {
                        this.pickUps[pickUpId].container.first.destroy();
                        this.pickUps[pickUpId].container.destroy();
                    }
                    delete this.pickUps[pickUpId];
                }
            }

            if (msg.type === 'leaderboard') {
                this.leaderboard = msg.leaderboard;
                let text = 'Leaderboard\n';
                this.leaderboard.forEach((entry, i) => {
                    text += `${i + 1}. ${entry.username} (${entry.totalScore})\n`;
                });
                if (this.leaderboardOverlay) {
                    this.leaderboardOverlay.textContent = text;
                }
            }

            if (msg.type === 'died') {
                this.showRespawnScreen();
            }
        });

        this.time.addEvent({
            delay: 1/10 * 1000,
            callback: () => {
                this.sendMouseInput();
            },
            callbackScope: this,
            loop: true
        });

        // Add split input handler
        this.input.keyboard.on('keydown-SPACE', () => {
            this.sendSplitInput();
        });
        
        // Add mobile split button handler
        const splitButton = document.getElementById('split-button');
        if (splitButton) {
            splitButton.onclick = () => {
                this.sendSplitInput();
            };
        }

        // Camera zoom settings
        this.minZoom = 0.5;
        this.maxZoom = 2;
        this.cameras.main.setZoom(1);

        // Mouse wheel zoom (desktop)
        this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY, deltaZ) => {
            let newZoom = Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, this.minZoom, this.maxZoom);
            this.cameras.main.setZoom(newZoom);
        });

        // Pinch zoom (mobile)
        this.pinchZooming = false;
        this.lastPinchDistance = null;
        this.input.on('pointermove', (pointer) => {
            if (pointer.pointers && pointer.pointers.length === 2) {
                const [p1, p2] = pointer.pointers;
                if (p1 && p2) {
                    const dx = p1.x - p2.x;
                    const dy = p1.y - p2.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (this.lastPinchDistance !== null) {
                        let zoomChange = (dist - this.lastPinchDistance) * 0.005;
                        let newZoom = Phaser.Math.Clamp(this.cameras.main.zoom + zoomChange, this.minZoom, this.maxZoom);
                        this.cameras.main.setZoom(newZoom);
                    }
                    this.lastPinchDistance = dist;
                    this.pinchZooming = true;
                }
            } else {
                this.lastPinchDistance = null;
                this.pinchZooming = false;
            }
        });

        // Add UI container to scene and ignore it in the main camera
        this.add.existing(this.uiContainer);
        this.cameras.main.ignore(this.uiContainer);
    }

    update(time, delta) {
        // Clamp camera zoom
        if (this.cameras.main.zoom < this.minZoom) this.cameras.main.setZoom(this.minZoom);
        if (this.cameras.main.zoom > this.maxZoom) this.cameras.main.setZoom(this.maxZoom);

        // Update FPS overlay
        if (this.fpsOverlay) {
            this.fpsOverlay.textContent = `FPS: ${Math.floor(this.game.loop.actualFps)}`;
        }

        const alphaStep = delta / (1000 / 30); // Fixed to match server's 30Hz

        for (const cell of Object.values(this.cells)) {
            if (cell.lerpAlpha === undefined) continue;

            cell.lerpAlpha = Math.min(cell.lerpAlpha + alphaStep, 1);

            const interpX = Phaser.Math.Linear(cell.lastX, cell.x, cell.lerpAlpha);
            const interpY = Phaser.Math.Linear(cell.lastY, cell.y, cell.lerpAlpha);
            cell.container.setPosition(interpX, interpY);
        }

        // Camera follows the midpoint of all player-controlled cells
        const playerCells = Object.values(this.cells).filter(cell => cell.ownerPlayerId === this.playerId);
        if (playerCells.length > 0) {
            let sumX = 0, sumY = 0;
            for (const s of playerCells) {
                sumX += s.container.x;
                sumY += s.container.y;
            }
            const midX = sumX / playerCells.length;
            const midY = sumY / playerCells.length;
            // Smooth camera following
            this.cameras.main.pan(midX, midY, 100, 'Linear', true);
        }
    }
    
    initCell(cellData, playerUsername)
    {
        let cell = {
            id: cellData.id,
            ownerPlayerId: cellData.ownerPlayerId,
            x: cellData.x,
            y: cellData.y,
            lastX: cellData.x,
            lastY: cellData.y,
            targetX: cellData.targetX,
            targetY: cellData.targetY,
            color: cellData.color,
            radius: cellData.radius,
            username: playerUsername,
            container: new Phaser.GameObjects.Container(this, cellData.x, cellData.y),
        };
        
        this.add.existing(cell.container);
        const cellCircle = this.add.graphics();
        cellCircle.fillStyle(cell.color, 1);
        cellCircle.fillCircle(0, 0, cell.radius);
        cellCircle.setPosition(0, 0);
        cell.container.add(cellCircle);

        const cellOutline = this.add.graphics();
        cellOutline.lineStyle(1, 0x000000, 1);
        cellOutline.strokeCircle(0, 0, cell.radius);
        cellOutline.setPosition(0, 0);
        cell.container.add(cellOutline);

        // Add username text above the cell
        const usernameText = this.add.text(0, -cell.radius - 15, cell.username, {
            font: '12px Arial',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 2,
            padding: { x: 4, y: 2 }
        });
        usernameText.setOrigin(0.5, 0.5);
        cell.container.add(usernameText);

        return cell;
    }

    initPickUp(pickUpData)
    {
        let pickUp = {
            id: pickUpData.id,
            x: pickUpData.x,
            y: pickUpData.y,
            color: pickUpData.color,
            radius: pickUpData.radius,
            container: new Phaser.GameObjects.Container(this, pickUpData.x, pickUpData.y),
        };
        
        this.add.existing(pickUp.container);
        const pickUpCircle = this.add.graphics();
        pickUpCircle.fillStyle(pickUp.color, 1);
        pickUpCircle.fillCircle(0, 0, pickUp.radius);
        pickUpCircle.setPosition(0, 0);
        pickUp.container.add(pickUpCircle);

        return pickUp;
    }
    
    sendMouseInput() {
        if(!this.playerId || this.socket.readyState !== WebSocket.OPEN) {return;}

        const pointer = this.input.activePointer;
        const mouseWorldPosition = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

        this.socket.send(JSON.stringify({
            type: 'input',
            id: this.playerId,
            targetX: mouseWorldPosition.x,
            targetY: mouseWorldPosition.y
        }))
    }

    sendSplitInput() {
        if(!this.playerId || this.socket.readyState !== WebSocket.OPEN) {return;}

        const pointer = this.input.activePointer;
        const mouseWorldPosition = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

        this.socket.send(JSON.stringify({
            type: 'split',
            id: this.playerId,
            targetX: mouseWorldPosition.x,
            targetY: mouseWorldPosition.y
        }));
    }
    
    getAllCellsById(allPlayerData) {
        const allCellsById = {};
    
        for (const player of Object.values(allPlayerData)) {
            for (const [cellId, cellData] of Object.entries(player.cells)) {
                allCellsById[cellId] = cellData;
            }
        }
    
        return allCellsById;
    }

    showRespawnScreen() {
        const overlay = document.getElementById('respawn-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            const respawnBtn = document.getElementById('respawn-button');
            if (respawnBtn) {
                respawnBtn.onclick = () => {
                    this.socket.send(JSON.stringify({ type: 'respawn' }));
                    this.hideRespawnScreen();
                };
            }
        }
    }

    hideRespawnScreen() {
        const overlay = document.getElementById('respawn-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }
}
