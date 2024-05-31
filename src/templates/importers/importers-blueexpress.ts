import {BaseImporters} from "./base.impoters";
import {InvalidFileException} from "../../common/exceptions";
import {IMPORTER_BLUEEXPRESS, IMPORTER_INTERRAPIDISIMO} from "./constants";


export class ImportersBlueexpress extends BaseImporters {

    startBy = 2; //number from read file

    addRows(ws) {
        this.ws = ws;

        if(this.hasFiles()){
            //reading all files and add to array
            /** Replace for Order Id And Tracking Id Position */
            const positionOrderId = 3;//C
            const positionTrackingId = 2;//B
            //const positionDeliveryAmountId = 19;//S

            const rows = this.ws.getRows(this.startBy, this.ws.actualRowCount);
            try {
                rows.map(item => {
                    const trackingNumber = item.getCell(positionTrackingId).toString();
                    //const deliveryAmount = item.getCell(positionDeliveryAmountId).toString();
                    const deliveryAmount = "0";
                    let id : any = item.getCell(positionOrderId).toString();
                    id = id.replace(/#/g, '');
                    if(id && id[1]) {
                        id = id[1].replace(/ /g, '');
                        this.collection.push({id, trackingNumber,deliveryAmount});
                    }
                });
            }catch(e){
                console.log("error", e.message);
                throw new InvalidFileException("Se ha producido un error leyendo el fichero");
            }
        }
    }

    getContext() {
        return this.collection;
    }

    getName() {
        return IMPORTER_BLUEEXPRESS;
    }

    hasFiles() {
        return this.ws.actualRowCount > 1 ? true : false;
    }

}
