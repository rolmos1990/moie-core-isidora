import dotenv = require('dotenv');

import express = require('express');
import { loadControllers } from 'awilix-express';
import loadContainer from './container';
import {createConnection} from "typeorm";
import MySQLPersistence from "./common/persistence/mysql.persistence";
import {Authorization} from './middlewares/authorization';
import * as cors from 'cors';
import {RunSeed} from "./seeds/run.seed";

import swaggerUi = require('swagger-ui-express');
import swaggerJsdoc = require('swagger-jsdoc');
//require('newrelic');

//options for cors midddleware
const options: cors.CorsOptions = {
    allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'X-Access-Token',
        'Authorization'
        ],
    };

const optionsSwagger = {
    definition: {
        openapi: "3.1.0",
        info: {
            title: "Moie Core for Lucy Modas - Api Swagger",
            version: "0.1.0",
            description:
                "This is the api specs for Moie Coree",
            license: {
                name: "MIT",
                url: "https://spdx.org/licenses/MIT.html",
            },
            contact: {
                name: "Moie - Lucy Modas",
                url: "https://www.lucymodas.com",
                email: "info@lucymodas.com",
            },
        },
        servers: [
            {
                url: "http://localhost:18210",
            },
        ],
    },
    apis: ["./routes/*.js"],
};

const specs = swaggerJsdoc(optionsSwagger);

const app: express.Application = express();


app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(specs, { explorer: true })
);
//use cors middleware
//use cors middleware
app.use(cors(options));
app.use(express.json({limit: '100mb'}));
app.use(express.urlencoded({limit: '100mb', extended: true}));
app.use('/css', express.static('css'));
app.use('/public', express.static('public'));
app.use('/uploads', express.static('../storage/uploads'));
app.use('/pdf', express.static('../storage/pdf'));
app.use('/attachments', express.static('../storage/attachments'));
app.use('/users', express.static('../storage/users'));
app.use('/catalogs', express.static('../storage/catalogs'));
app.use('/loaderio-f308d2b83e3c02cf93098a33059ed07d.txt', express.static('public/loaderio-f308d2b83e3c02cf93098a33059ed07d.txt'));

//use cors middleware
//app.use(express.json({limit: "50mb"}));
//app.use(express.urlencoded({limit: "50mb", extended: true, parameterLimit:913566363}));
//app.use(cors(options));

//Blocked use for this directories

// JSON Support
//app.use(express.json());

// Controllers
createConnection(MySQLPersistence).then(async connection => {
    loadContainer(app);
    app.use(Authorization); //disable validation
    app.use(loadControllers(
        'controllers/*.ts',
        { cwd: __dirname }
    ));
    app.use(Authorization, express.static('storage'));
    if(process.env.SEED_DB) {
        new RunSeed();
    }
});

export { app };
