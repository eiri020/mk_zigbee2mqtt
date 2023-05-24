FROM node:16

WORKDIR /app

COPY . .

RUN npm install
RUN ./node_modules/typescript/bin/tsc

RUN rm -rf node_modules
RUN npm install --omit=dev

CMD [ "node", "dist/index.js" ]
