import {BaseExporters} from "./base.exporters";
import {Order} from "../../models/Order";
import {EXPORTER_BLUEEEXPRESS_CD, EXPORTER_INTERRAPIDISIMO_CD} from "./constants";
import {SingleBaseExporters} from "./single.base.exporters";
import {formatPrice, formatPriceWithoutDecimals} from "../../common/helper/helpers";
import {toUpper} from "./utilities";

export class ExportersBlueexpressCd extends SingleBaseExporters {

    getSheetName(): String {
        return "Worksheet";
    }

    getFileName(){
        return 'Blueexpress_Contrapago.xlsx';
    }

    getConverter(weight){
        if(parseFloat(weight) < 1000){
            return 1;
        } else {
            return (Math.floor(Number(weight) / 1000));
        }

    }

    getBody(data: Order[]) {

        const body = data.map(item => ({
            blank: '',
            name: item.customer.name,
            phone: item.customer && item.customer.cellphone,
            phone2: item.customer.phone,
            email: item.customer.email || 'envios@isidoramodas.com',
            address: item.customer.address || "",
            cityCode: item.orderDelivery && item.orderDelivery.deliveryLocality && item.orderDelivery.deliveryLocality.deliveryAreaCode,
            city: item.customer && item.customer.municipality && item.customer.municipality.name.toUpperCase(),
            weight: this.getConverter(item.totalWeight),
            orderId: '#' + item.id,
            hasCod: 'S',
            price: formatPriceWithoutDecimals(item.totalAmount),
        }));

        return body;
    }

    getHeader() {
        const headers = [
            { header: 'Nombre destinatario', key: 'name' },
            { header: 'Código Region', key: 'blank'},
            { header: 'Nombre comuna / localidad', key: 'city'},
            { header: 'Dirección Completa', key: 'address'},
            { header: 'Telefono > Número', key: 'phone2'},
            { header: 'Celular', key: 'phone'},
            { header: 'Email', key: 'email'},
            { header: 'Código Interno Cliente', key: 'blank'},
            { header: 'Cantidad de Piezas', key: 'qty'},
            { header: 'Cantidad de unidades', key: 'blank'},
            { header: 'Peso físico', key: 'weight'},
            { header: 'Observación', key: 'blank'},
            { header: 'N° de Referencia 1', key: 'orderId'},
            { header: 'N° de Referencia 2', key: 'blank'},
            { header: 'N° de Referencia 3', key: 'blank'},
            { header: 'N° de Referencia 4', key: 'blank'},
            { header: 'Documento de Devolución N°1', key: 'blank'},
            { header: 'Documento de Devolución N°2', key: 'blank'},
            { header: 'Documento de Devolución N°3', key: 'blank'},
            { header: 'Documento de Devolución N°4', key: 'blank'},
            { header: 'Tiene Cobro contra Entrega', key: 'hasCod'},
            { header: 'Valor a cobrar contra entrega', key: 'price'},
            { header: 'Tiene Seguro Adicional', key: 'blank'},
            { header: 'Valor declarado', key: 'blank'},
            { header: 'Centro de costo', key: 'blank'}
        ];;
        return headers;
    }

    getName() {
        return EXPORTER_BLUEEEXPRESS_CD;
    }

}
