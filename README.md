# Awesome Project Build with TypeORM (moie2 )

Steps to run this project:

1. Run `npm i` command
2. Setup database settings inside `ormconfig.json` file
   1. Run `npm start` command

## MYSQL  test 8

    SET GLOBAL sql_mode=(SELECT REPLACE(@@sql_mode,'ONLY_FULL_GROUP_BY',''));
    SET SESSION sql_mode=(SELECT REPLACE(@@sql_mode,'ONLY_FULL_GROUP_BY',''));
    SET SQL_MODE = '';


## DOCKER UPLOAD

    docker build -t rolmos/moie-isidora-api .
    docker tag {TAG_VERSION} rolmos/moie-isidora-api
    docker push rolmos/moie-isidora-api


#RUN ON SERVER
   docker build -t rolmos/moie-lucy-api .

   docker run -e PORT=18211 \
   -e HOST=http://localhost \
   -e DB_HOST=100.25.183.88 \
   -e DB_PORT=3306 \
   -e DB_USERNAME=root \
   -e DB_DATABASE=moie-lucy-v2 \
   -e DB_PASSWORD=Panama2018. \
   -e SEED_DB=false \
   -e DIAN_USER=1CCC171F7911107313 \
   -e DIAN_PASSWORD=1CCC171F7911107313 \
   -e PUBLIC_URL=http://localhost:18211 \
   --name moie-lucy-api \
   -dp 18211:18211 rolmos/moie-lucy-api


COMPOSE_DEBUG=1 APP_VERSION=0.1-3c30aea NEW_RELIC_LICENSE_KEY="" NEW_RELIC_APP_NAME="" WEBSITE_URL=lucymodas.com PORT=18211 HOST=http://localhost DB_HOST=100.25.183.88 DB_PORT=3306 DB_USERNAME=root DB_DATABASE=moie-lucy-v2 DB_PASSWORD=Panama2018. SEED_DB=false DIAN_USER=1CCC171F7911107313 DIAN_PASSWORD=1CCC171F7911107313 PUBLIC_URL=http://localhost:18211 docker-compose up -d

