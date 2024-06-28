import {BaseRequester} from "../BaseRequester";
import {Order} from "../../../models/Order";
import moment = require("moment");
import {OrderDetail} from "../../../models/OrderDetail";
import axios from "axios";

export class BillingCreateImpl {

    protected order : Order;
    protected settings : any;
    constructor() {
    }

    Prepare(order: Order, settings: any): any {
        this.order = order;
        this.settings = settings;
        return this;
    }

    async Call() {

        const items = this.order.orderDetails;

        function handlerBillingDetail(orderDetail: OrderDetail, settings: any) {

            const tax_amount = settings['tax'];
            const price_without_tax = orderDetail.product.price / (1 + tax_amount);

            const payload = {
                "netUnitValue": parseFloat(price_without_tax.toFixed(2)),
                "discount": parseFloat(orderDetail.discountPercent.toString()),
                "quantity": orderDetail.quantity,
                "taxes": [{
                    "code": settings["code"],
                    "percentage": settings["taxPercentage"]
                }],
                "sku": orderDetail.product.id.toString(),
                "comment": orderDetail.product.name
            };

            return payload;
        }

        let response = {};

        var settings = this.settings;

        let detailsForBillings = [];
        try {
            detailsForBillings = items.map((orderDetail) => handlerBillingDetail(orderDetail, settings));
        }catch(e){
            console.log("error on get details");
        }

        const order = this.order || {customer: {document: null, state: {name: null}, municipality: {name: null}}};
        const customer = order.customer;

        const body =  {
            'documentTypeId': settings["documentTypeId"],
            'emissionDate': moment().unix(),
            'municipality': customer.municipality.name,
            'city': customer.state.name,
            'address': customer.municipality.name,
            'clientCode': customer.document,
            'details': [...detailsForBillings]
        };

        try {
        const url = settings['api'];

        const headers = {
            'access_token': settings["access_token"]
        };

        response = await axios.post(url, body, {headers});

        var responseString = response['data'];

        return {request: body, response: responseString, status: 1};

        }catch(e){
            let errorMessage = "";
            if (e.response) {
                // El servidor respondió con un código de estado fuera del rango de 2xx
                errorMessage = `Error: ${e.response.status} - ${e.response.statusText}`;
                if (e.response.data && typeof e.response.data === 'object') {
                    errorMessage = e.response.data;
                }
            } else if (e.request) {
                errorMessage = 'No se recibió respuesta del servidor';
            } else {
                errorMessage = `Error: ${e.message}`;
            }
            response = { error: errorMessage };
            return { request: body, response, status: 0 };
        }

    }

}
