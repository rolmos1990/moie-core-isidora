import {BaseRequester} from "../BaseRequester";
import {Order} from "../../../models/Order";
import {TrackingDelivery} from "./DeliveryStatusImpl";
import moment = require("moment");

export class DeliveryStatusBlueExpress extends BaseRequester {

    protected  order;
    constructor(order: Order) {
        super();
        this.order = order;
    }

    getUrl(): any {
        return `https://bx-tracking.bluex.cl/bx-tracking/v1/tracking-pull/${this.order.orderDelivery.tracking}`;
    }

    call(): any {
    }

    getHeaders(): any{
        return {
            "BX-TOKEN": `d53306d5fdad69e538a8ad6407c5cf10`,
            "BX-USERCODE": "172933",
            "BX-CLIENT-ACCOUNT": "77926914-1-8"
        };
    }

    obtenerUltimoPinchazo = (data) => {
        const pinchazos = data.data.pinchazos;

        if (pinchazos && pinchazos.length > 0) {
            return pinchazos[pinchazos.length - 1];
        } else {
            return null; // Si no hay pinchazos
        }
    };

    getContext(body): any {

        const content = body["data"]

        const pinchazos = content['pinchazos'];
        let pinchazo = {};

        const locations = content['location'];
        let location = "";

        if(pinchazos && pinchazos.length > 0){
            pinchazo = pinchazos[pinchazos.length - 1];
        }

        if(locations && locations.length > 0){
            location = (locations[locations.length - 1])["nombreLocalidad"];
        } else {
            location  = content["origen"]["comuna"];
        }

        const fecha = pinchazo['tipoMovimiento']['fechaHora'];
        const ubicacion = location;
        const estatus = pinchazo['tipoMovimiento']['descripcion'];

        const stopStatus = ['ENTREGADO','RETIRADO','DEVOLUCION ENTREGADA'];
        const shouldStop = stopStatus.includes(estatus.toUpperCase());

        const tracking : TrackingDelivery = {
            date: moment(fecha).toDate(),
            status: estatus,
            locality: ubicacion,
            sync: !shouldStop
        }

        return tracking;
    }

    getMethod() : any {
        return null;
    }

    getBody() : any {
        return null;
    }

}
