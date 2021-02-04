---
to: <%= h.changeCase.param(name) %>/package.json
---

{
    "name": "tensei-<%= h.changeCase.param(name) %>",
    "version": "1.0.0",
    "main": "./build/server/plugin.js",
    "license": "MIT",
    "types": "./build/server/plugin.d.ts",
    "files": [
        "build/"
    ],
    "scripts": {
        "prettier": "prettier --write './**/*.{js,json,ts,css}'",
        "build:server": "tsc --p tsconfig.server.json",
        "build:client": "cross-env NODE_ENV=production webpack --config=node_modules/laravel-mix/setup/webpack.config.js",
        "dev:server": "tsc --watch --p tsconfig.server.json",
        "dev:client": "webpack --config=node_modules/laravel-mix/setup/webpack.config.js --watch",
        "test": "jest --verbose --runInBand --forceExit",
        "build": "yarn build:server && yarn build:client"
    },
    "devDependencies": {
        "@tensei/common": "^0.5.12",
        "@tensei/components": "^0.5.12",
        "autoprefixer": "^10.2.4",
        "laravel-mix": "^6.0.5",
        "postcss": "^8.2.4",
        "tailwindcss": "^2.0.2",
        "typescript": "^4.1.3"
    }
}