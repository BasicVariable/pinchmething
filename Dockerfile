# Taken from https://nodejs.org/en/docs/guides/nodejs-docker-webapp/
FROM node:18
# Create app directory
COPY . /app
WORKDIR /app/JS
# update packages
RUN npm i js-yaml
RUN npm install

CMD node index.js
