#!/bin/bash

# Deploy script for AWS Lightsail
echo "Building for production..."
npm run build:prod

echo "Starting server with PM2..."
pm2 start ecosystem.config.js --env production

echo "Saving PM2 configuration..."
pm2 save

echo "Setting up PM2 to start on boot..."
pm2 startup

echo "Deployment complete!"
echo "Server should be running on port 8080" 