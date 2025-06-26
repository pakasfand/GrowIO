import { Game } from "phaser";
import { MainScene } from "./client";

const config = {
    type: Phaser.AUTO,
    parent: "phaser-container",
    width: window.innerWidth,
    height: window.innerHeight,
    pixelArt: false,
    roundPixel: false,
    antialias: true,
    scene: [
        MainScene,
    ]
};

window.addEventListener('load', function() {
    const savedUsername = localStorage.getItem('growio_username');
    if (savedUsername) {
        document.getElementById('username').value = savedUsername;
    }
    
    document.getElementById("play-button").onclick = function() {
        startGame();
    };
    
    // Allow Enter key to submit
    document.getElementById('username').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            startGame();
        }
    });
});

function startGame() {
    const username = document.getElementById('username').value.trim();
    if (username.length === 0) {
        alert('Please enter a username!');
        return;
    }
    
    if (username.length > 20) {
        alert('Username must be 20 characters or less!');
        return;
    }
    
    // Store username in localStorage for persistence
    localStorage.setItem('growio_username', username);
    
    // Hide login, show game
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    
    // Start the game with username
    startGameWithUsername(username);
}

let gameInstance = null;

// Make the game start function globally accessible
function startGameWithUsername(username) {
    if (gameInstance) {
        gameInstance.destroy(true);
    }
    
    // Store username globally for the scene to access
    window.playerUsername = username;
    
    gameInstance = new Game(config);
};