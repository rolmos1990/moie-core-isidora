import {BaseService} from "../common/controllers/base.service";
import {Bill} from "../models/Bill";
import {BillRepository} from "../repositories/bill.repository";
import {Order} from "../models/Order";
import {OrderService} from "./order.service";
import {ConditionalQuery} from "../common/controllers/conditional.query";
import {Operator} from "../common/enum/operators";
import {BillConfig} from "../models/BillConfig";
import {BillConfigRepository} from "../repositories/billConfig.repository";
import {InvalidArgumentException} from "../common/exceptions";
import {BillStatus} from "../common/enum/billStatus";
import {ClientsManagementService} from "./clientsManagement.service";
import {CreateBillSoap} from "../templates/soap/bills/CreateBillSoap";
import {EBillType} from "../common/enum/eBill";
import {BillCreditMemo} from "../models/BillCreditMemo";
import {BillCreditMemoRepository} from "../repositories/billCreditMemo.repository";
import {InvalidMunicipalityException} from "../common/exceptions/invalidMunicipality.exception";
import {InvalidDocumentException} from "../common/exceptions/invalidDocument.exception";
import {Between} from "typeorm";
import {BillingCreateImpl} from "../common/requesters/billing/billingCreateImpl";
import {OrderDetail} from "../models/OrderDetail";


export class BillService extends BaseService<Bill> {
    constructor(
        private readonly billRepository: BillRepository<Bill>,
        private readonly billCreditMemoRepository: BillCreditMemoRepository<BillCreditMemo>,
        private readonly billConfigRepository: BillConfigRepository<BillConfig>,
        private readonly orderService: OrderService,
        private readonly clientManagementService: ClientsManagementService
    ){
        super(billRepository);
    }

    async getLastNumber() : Promise<any> {

        const lastNumber = this.billRepository.createQueryBuilder('b')
            .select("MAX(b.legal_number)", "max")
        const result = await lastNumber.getRawOne();
        let nexLegalNumber = result["max"] ? (result["max"] + 1) : null;

            const conditional = new ConditionalQuery();

            if(nexLegalNumber != null){
                conditional.add("startNumber", Operator.LESS_OR_EQUAL_THAN, nexLegalNumber);
                conditional.add("finalNumber", Operator.GREATHER_OR_EQUAL_THAN, nexLegalNumber);
            }

            conditional.add("status", Operator.EQUAL, 1);

            const billConfig = await this.billConfigRepository.findByObject(conditional.get());

            //empiezo a partir de donde diga la configuracion
            if(nexLegalNumber == null){
                nexLegalNumber = billConfig[0].startNumber;
            }

            if(billConfig.length <= 0){
                throw new InvalidArgumentException("No es posible procesar la siguiente factura");
            }

        return {number: nexLegalNumber, config: billConfig[0]};
    }

    /** Generar una Factura a Partir de una Orden */
    async generateBill(order : Order){

        const hasOrder = await this.findByObject({order});
        if(hasOrder.length === 0) {

            const taxAmount = 19; //Todo -- Llevar a una configuración (Actualmente esta asi).

            const bill = new Bill();
            bill.order = order;
            const getLastNumberInfo = await this.getLastNumber();
            bill.legalNumber = getLastNumberInfo.number;
            bill.tax = taxAmount;
            bill.billConfig = getLastNumberInfo.config;
            bill.status = BillStatus.PENDING;

            const billresult = await this.createOrUpdate(bill);
            return billresult;
        } else {
            throw new InvalidArgumentException("Orden: " + order.id + ", contiene una factura vigente");
        }
    }

    async findByStatus(status : BillStatus, limit = 10) : Promise<Bill[]>{
        const bills = await this.billRepository.findByObjectWithLimit({
            status: status
        }, ['order', 'order.orderDetails', 'order.customer', 'order.orderDelivery', 'billConfig', 'order.customer.state', 'order.customer.municipality'],
            limit
            );
        return bills;
    }

    async findBill(billId) : Promise<Bill>{
        const bill = await this.billRepository.find(billId, ['order', 'order.orderDetails', 'order.customer', 'order.orderDelivery', 'billConfig', 'order.customer.state', 'order.customer.municipality', 'creditMemo']);
        return bill;
    }

    async deleteMemoByBill(creditMemo: BillCreditMemo) {
       return this.billCreditMemoRepository
           .createQueryBuilder("o")
           .where("o.bill", creditMemo.bill)
           .delete();
    }

    async createMemo(bill: Bill, type : EBillType) : Promise<BillCreditMemo> {
        const creditMemo = new BillCreditMemo();
        creditMemo.bill = bill;
        creditMemo.memoType = type;
        creditMemo.status = false;
        const memo = await this.billCreditMemoRepository.save(creditMemo);
        return memo;
    }

    async updateMemo(billMemo: BillCreditMemo) : Promise<BillCreditMemo> {
        const memo = await this.billCreditMemoRepository.save(billMemo);
        return memo;
    }

    /** Enviar un Documento XML para enviar factura */
    /** Genera un documento de facturación electronica */
    /* Type -> Identifica si es un documento de Credito, Debito */
    /* Async -> Tipo de respuesta del servicio */

    async sendElectronicBill(bill: Bill, type : EBillType, async, creditMemo : BillCreditMemo = undefined){

        //-- DIAN USER / DIAN PASSWORD = 1CCC171F7911107313  --
        const user = process.env.DIAN_USER;
        const password = process.env.DIAN_PASSWORD;

        if(!bill.order.customer.municipality){
            throw new InvalidMunicipalityException;
        }
        if(!bill.order.customer.document){
            throw new InvalidDocumentException;
        }

        const auth = new Buffer(`${user}:${password}`).toString("base64");

        const soapBody = new CreateBillSoap(bill, type, creditMemo);

        const options = {
            url: 'https://www.febtw.co:8097/ServiceBTW/FEServicesBTW.svc?wsdl',
            headerOptions: {Authorization: auth},
            body: soapBody,
            callMethod: "RecepcionXmlFromERP"
        };

        this.clientManagementService.addHeaders("Authorization", auth);

        const res = await this.clientManagementService.callSoapClient(options);

        if(res["RecepcionXmlFromERPResult"]){

            //save log
            await this.saveLog(bill, type, res);
            if(res["RecepcionXmlFromERPResult"]["success"]){
                //Validacion para determinar si fue timbrado o no
                if( res["RecepcionXmlFromERPResult"]["Tracer"].indexOf('FIN Log Timbrado factura DIAN') > 0){
                    return true;
                } else {
                    throw new InvalidArgumentException("No se pudo generar la factura");
                }
            } else{
                throw new InvalidArgumentException("No se pudo recibir la factura");
            }
        } else {
            throw new InvalidArgumentException("No se pudo recibir la factura");
        }
    }

    async saveLog(bill: Bill, _type: EBillType, res: any){
        if(_type === EBillType.INVOICE){
            if(res && res["RecepcionXmlFromERPResult"] && res["RecepcionXmlFromERPResult"]["Tracer"]) {
                const log = res["RecepcionXmlFromERPResult"]["Tracer"];
                bill.dianLog = log;
                await this.billRepository.save(bill);
            }
        } else {
            if(res && res["RecepcionXmlFromERPResult"] && res["RecepcionXmlFromERPResult"]["Tracer"]) {
                const log = res["RecepcionXmlFromERPResult"]["Tracer"];
                bill.dianCreditMemoLog = log;
                await this.billRepository.save(bill);
            }
        }
    }

    /** Reporte basado en Facturación */
    async getDataForReport(dateFrom, dateTo, fromCreditMemo = false){
        let bills;
        if(fromCreditMemo){
            bills = await this.billRepository.createQueryBuilder('b')
                .leftJoinAndSelect('b.order', 'o')
                .leftJoinAndSelect('b.billConfig', 's')
                .leftJoinAndSelect('o.customer', 'c')
                .leftJoinAndSelect('c.municipality', 'm')
                .leftJoinAndSelect('b.creditMemo', 'cm')
                .leftJoinAndSelect('o.orderDelivery', 'od')
                .where("cm.createdAt >= :dateFrom", { dateFrom: dateFrom })
                .andWhere("cm.createdAt <= :dateTo", { dateTo: dateTo })
                .getMany();
        } else {
            bills = await this.billRepository.createQueryBuilder('b')
                .leftJoinAndSelect('b.order', 'o')
                .leftJoinAndSelect('b.billConfig', 's')
                .leftJoinAndSelect('o.customer', 'c')
                .leftJoinAndSelect('c.municipality', 'm')
                .leftJoinAndSelect('b.creditMemo', 'cm')
                .leftJoinAndSelect('o.orderDelivery', 'od')
                .where({
                    createdAt: Between(dateFrom, dateTo)
                })
                .getMany();
        }

        if(bills){
            //Asignar productos a las ordenes
            await Promise.all(bills.map(async bill => {
               bill['order']['orderDetails'] = await this.orderService.getDetails(bill.order);
            }));

        }

        return bills;

    }

    async createBill(order: Order, settings : any){
            //Solameent es creada si esta en orden conciliada
            if(order.isFinished()){
            const billBuilder = new BillingCreateImpl();

            const orderDetails: OrderDetail[] = await this.orderService.getDetails(order);
            order.orderDetails = orderDetails;

            const resultBody = await billBuilder.Prepare(order, settings)
                .Call();

            const bill = new Bill().newBill(order, JSON.stringify(resultBody));
            await this.billRepository.save(bill);
        }
    }
}
