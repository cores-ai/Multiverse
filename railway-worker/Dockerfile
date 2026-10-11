# Use official Node.js image (Bookworm is based on Debian 12)
FROM node:20-bookworm-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install npm dependencies
RUN npm install

# Install Playwright browsers and missing OS dependencies as root
RUN npx playwright install firefox
RUN npx playwright install-deps firefox

# Copy the rest of the application code
COPY . .

# Start the bot
CMD ["npm", "start"]
