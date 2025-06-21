import { Game } from "phaser";
import { MainScene } from "./client";

// More information about config: https://newdocs.phaser.io/docs/3.70.0/Phaser.Types.Core.GameConfig
const config = {
    type: Phaser.AUTO,
    parent: "phaser-container",
    width: window.innerWidth,
    height: window.innerHeight,
    scale: {
        mode: Phaser.Scale.RESIZE, // Automatically resize to fit the window
        autoCenter: Phaser.Scale.CENTER_BOTH, // Center the canvas
    },
    // backgroundColor: "#1c172e",
    pixelArt: false,
    roundPixel: false,
    antialias: true,
    // max: {
    //     width: 800,
    //     height: 600,
    // },
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    physics: {
        default: "arcade",
        arcade: {
            gravity: { y: 0 },
            debug: true
        }
    },
    scene: [
        MainScene,
    ]
};

new Game(config);