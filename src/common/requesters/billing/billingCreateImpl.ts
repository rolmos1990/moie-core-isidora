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

        try {
        var settings = this.settings;
        const detailsForBillings = items.map((orderDetail) => handlerBillingDetail(orderDetail, settings));

        const body =  {
            'documentTypeId': settings["documentTypeId"],
            'emissionDate': 1686094800,
            'municipality': this.order.customer.municipality.name,
            'city': this.order.customer.state.name,
            'address': this.order.customer.municipality.name,
            'clientCode': this.order.customer.document,
            'details': [...detailsForBillings]
        };

        const url = settings['api'];

        const headers = {
            'access_token': settings["access_token"]
        };

        response = await axios.post(url, body, {headers});
        var responseString = response['data'];
        return responseString;
        }catch(e){
            console.log('e.message', e.message);
            response = {error: (e.response  && e.response.statusText) ? e.response.statusText : e.message};
            return response;
        }

    }

}
