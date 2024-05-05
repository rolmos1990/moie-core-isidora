import {BaseService} from "../common/controllers/base.service";
import {Order as OrderParserCreate, OrderUpdate as OrderParserUpdate} from '../controllers/parsers/order';

import {OrderRepository} from "../repositories/order.repository";
import {OrderDetail} from "../models/OrderDetail";
import {OrderDetailRepository} from "../repositories/orderDetail.repository";
import {OrderProduct} from "../controllers/parsers/orderProduct";
import {ProductSizeService} from "./productSize.service";
import {InvalidArgumentException} from "../common/exceptions";
import {Order} from "../models/Order";
import {CustomerService} from "./customer.service";
import {User} from "../models/User";
import {string_to_slug} from "../common/helper/helpers";
import {ProductSize} from "../models/ProductSize";
import {OrderDelivery} from "../models/OrderDelivery";
import {OrderDeliveryRepository} from "../repositories/orderDelivery.repository";
import {DeliveryTypes, getDeliveryType} from "../common/enum/deliveryTypes";
import {DeliveryMethodService} from "./deliveryMethod.service";
import {Office} from "../models/Office";
import {DeliveryLocalityService} from "./deliveryLocality.service";
import {IsNull, Not} from "typeorm";
import {isSell, OrderStatus} from "../common/enum/orderStatus";
import {FieldOptionService} from "./fieldOption.service";
import {StatTimeTypes} from "../common/enum/statsTimeTypes";
import {OrderHistoricService} from "./orderHistoric.service";
import {StatusManagerController} from "../common/controllers/status.manager.controller";
import {Modules} from "../common/enum/modules";
import {builderOrderTypes} from "../common/enum/orderTypes";
import {toDateFormat} from "../templates/exporters/utilities";
import {converterPreOrderProductInOrderDetail} from "../common/helper/converters";
import {OrderConditional} from "../common/enum/order.conditional";
import {Customer} from "../models/Customer";
import moment = require("moment");
import {ItemsService} from "./items.service";

export class OrderService extends BaseService<Order> {
    constructor(
        private readonly orderRepository: OrderRepository<Order>,
        private readonly  orderDetailRepository: OrderDetailRepository<OrderDetail>,
        private readonly  orderDeliveryRepository: OrderDeliveryRepository<OrderDelivery>,
        private readonly productSizeService: ProductSizeService,
        private readonly customerService: CustomerService,
        private readonly deliveryMethodService: DeliveryMethodService,
        private readonly deliveryLocalityService: DeliveryLocalityService,
        private readonly fieldOptionService: FieldOptionService,
        private readonly orderHistoricService: OrderHistoricService,
        private readonly itemsService: ItemsService
    ) {
        super(orderRepository);
    }

    async findFull(id: any, addRelations = []){
        let relations = ['orderDetails','orderDelivery', 'orderDelivery.deliveryLocality', 'deliveryMethod', 'customer', 'user'];
        if(addRelations && addRelations.length > 0){
            relations = relations.concat(addRelations);
        }
        const _order = await this.find(parseInt(id), relations);
        const _orderDetails = await this.getDetails(_order);
        _order.orderDetails = _orderDetails;
        return _order;
    }

    newOrder() : Order{
        const _order = new Order();
        _order.initialize();
        return _order;
    }

    async update(_order: Order) : Promise<Order>{
        const order = await this.createOrUpdate(_order);
        return order;
    }

    async updateWithOrderDelivery(order: Order) : Promise<Order>{
        await this.createOrUpdate(order);
        await this.orderDeliveryRepository.save(order.orderDelivery);
        return order;
    }

    /**
     * Actualiza los estados de una orden (Si cumple con las reglas indicadas)
     * @param order[]
     */
    async updateNextStatusFromModule(order: Order, user: User, _module: Modules) : Promise<Order> {
        const _orderType = builderOrderTypes(order);
        if(_module === Modules.Offices){
            if(_orderType.isMensajero()){
                return this.updateNextStatus(order, user);
            } else {
                return;
            }
        }
        else if(_module === Modules.PostVenta){
            if((_orderType.isServientrega() || _orderType.isInterrapidisimo() || _orderType.isPayu()) && order.isPrinted()){
                if(order.status === OrderStatus.SENT){
                    //Si ya esta enviado, se mantiene enviado
                    return;
                } else {
                    return this.updateNextStatus(order, user);
                }
            }
        }

        throw new InvalidArgumentException("No se pudo ejecutar siguiente estado");
    }

    /**
     * Actualiza los estados de una orden
     * @param order[]
     */
    async updateNextStatus(order: Order, user?: User) : Promise<Order> {
        const _statusManager = new StatusManagerController(
            order,
            this.orderRepository,
            user,
            this.orderHistoricService,
            this.itemsService
            );
        try {
            await _statusManager.next();
            await this.addMayorist(order, true);
            return _statusManager.getOrder();
        }catch(e){
            throw new InvalidArgumentException("Estado no pudo ser actualizado");
        }
    }

    /**
     * Realizar la anulacion de una orden
     * @param order[]
     */
    async cancelOrder(order: Order, user: User) : Promise<void> {
        const orderDetails: OrderDetail[] = await this.getDetails(order);
        await this.addMayorist(order, true);
        await this.updateInventaryForOrderDetail(orderDetails, true);

        const _statusManager = new StatusManagerController(
            order,
            this.orderRepository,
            user,
            this.orderHistoricService,
            this.itemsService
        );
        await _statusManager.cancel();
    }


    async updateOrderDetail(_order: Order, newProducts: OrderProduct[], user: User, trackStatus = false){
        const productSizes = await this.productSizeService.findByIds(newProducts.map(item => item.productSize));

       //Check inventary
        const tmpDetail : OrderDetail[] = await converterPreOrderProductInOrderDetail(_order, newProducts, productSizes);
        const _oldDetails = await this.getDetails(_order);
        await this.productSizeService.checkInventary(tmpDetail, _oldDetails);

        const orderDetail : OrderDetail[] = await converterPreOrderProductInOrderDetail(_order, newProducts, productSizes);


        //Remove old inventary
        if(_order.orderDetails && _order.orderDetails.length > 0) {
            await this.productSizeService.updateProductSize(_order.orderDetails, true);
            await this.orderDetailRepository.deleteFrom(_order);
        }

        //Add new Inventary
        await this.orderDetailRepository.saveMany(orderDetail);
        await this.productSizeService.updateProductSize(orderDetail, false);

        const updatedOrder = await this.findFull(_order.id);

        //restart order to initial status
        if(trackStatus) {
            const _statusManager = new StatusManagerController(updatedOrder, this.orderRepository, user, this.orderHistoricService, this.itemsService);
            await _statusManager.restart();
        }

        return await this.recalculateCosts(updatedOrder);
    }

    /** Cada vez que se realiza algun cambio en una orden se debe llamar este para recalcular los costos */
    async recalculateCosts(_order: Order){

        const costs = await this.getCalculateCosts(_order.orderDetails);

        const deliveryCost = _order.orderDelivery.deliveryCost;

        _order.totalAmount = (costs.totalAmount - costs.totalDiscount) + Number(deliveryCost);
        _order.subTotalAmount = costs.totalAmount;
        _order.totalDiscount = costs.totalDiscount;
        _order.totalWithDiscount = _order.subTotalAmount - _order.totalDiscount;
        _order.totalRevenue = costs.totalRevenue;
        _order.totalWeight = costs.totalWeight;
        _order.quantity = _order.orderDetails.reduce((s,p) => p.quantity + s, 0);

        await this.createOrUpdate(_order);

        return _order;
    }

    async restart(_order: Order, _user: User) : Promise<Order>{
        const _statusManager = new StatusManagerController(_order, this.orderRepository, _user, this.orderHistoricService, this.itemsService);
        await _statusManager.restart();
        const order = _statusManager.getOrder();
        return order
    }

    /**
     * Devuelve una orden al inicio si ha sido cambiada y maneja fechas de modificacion (ordenamiento).
     */
    async checkWasUpdated(_order: Order, _user: User){
        let checkedOrder = _order;
        const order = await this.findFull(_order.id);
        if(order.hasDiffWith(_order)){
            if(_order.isPending()){
                _order.modifiedDate = new Date();
            }
            const _statusManager = new StatusManagerController(_order, this.orderRepository, _user, this.orderHistoricService, this.itemsService);
            await _statusManager.restart();
            checkedOrder = _statusManager.getOrder();
        }

        return checkedOrder;
    }

    /**
     * Crea o actualiza un objeto de orden a traves de un parse
     * @param order[]
     */
    async registerOrder(_order: Order, parse: OrderParserCreate | OrderParserUpdate, user: User){

        const isNew = _order.isEmpty();
        const deliveryCost = (parse.deliveryCost !== undefined && parse.deliveryCost >= 0) ? parse.deliveryCost : _order.orderDelivery.deliveryCost;
        const customer = parse.customer ? await this.customerService.findFull(parse.customer) : _order.customer;

        const deliveryMethod = parse.deliveryMethod ? await this.deliveryMethodService.findByCode(parse.deliveryMethod) : _order.deliveryMethod;

        let deliveryLocality = parse.deliveryLocality ? await this.deliveryLocalityService.find(parse.deliveryLocality) : _order.orderDelivery.deliveryLocality;

        if(parse.deliveryLocality === null){
            deliveryLocality = null;
        }

        const hasTrackingChanged = (_order.orderDelivery.tracking !== parse.tracking) && parse.tracking;
        const hasChangeDeliveryCost = (_order.orderDelivery.deliveryCost !== deliveryCost);

        /** Order Information */
        _order.photos = parse.photos || _order.photos;
        _order.prints = parse.prints || _order.prints;
        _order.customer = customer;
        _order.origen = parse.origen || _order.origen;
        _order.expiredDate = new Date();
        _order.remember = _order.remember || false;
        _order.createdAt = _order.createdAt || new Date();

        if(!hasTrackingChanged) {
            _order.office = null;
        }

        /** Delivery Information in Order */
        _order.orderDelivery.chargeOnDelivery = parse.isChargeOnDelivery();
        _order.orderDelivery.deliveryType = parse.deliveryType || _order.orderDelivery.deliveryType;
        _order.orderDelivery.deliveryCost = deliveryCost || 0;
        _order.orderDelivery.deliveryOtherDescription = parse.otherMethod;
        _order.deliveryMethod = deliveryMethod;
        _order.orderDelivery.tracking = parse.tracking || _order.orderDelivery.tracking || null;
        _order.paymentMode = parse.paymentMode || _order.paymentMode || null;
        _order.orderDelivery.deliveryLocality = deliveryLocality || null;
        _order.user = !_order.user ? user : _order.user;
        _order.piecesForChanges = parse.piecesForChanges || _order.piecesForChanges || 0;

        await this.createOrUpdate(_order);
        await this.orderDeliveryRepository.save(_order.orderDelivery);

        if(!isNew){
            /** Recalculate cost in order if has any change in costs */
            if(hasChangeDeliveryCost){
                await this.recalculateCosts(_order);
            }
            /** Tracking historic for order (change status if be changed) */
            if(!hasTrackingChanged){
              _order = await this.checkWasUpdated(_order, user);
            } else {
                const _statusManager = new StatusManagerController(_order, this.orderRepository, user, this.orderHistoricService, this.itemsService);
                await _statusManager.next();
            }
        } else {
            const _statusManager = new StatusManagerController(_order, this.orderRepository, user, this.orderHistoricService, this.itemsService);
            await _statusManager.start();
        }

        return _order;

    }

    /**
     * Obtener calculo total de ordenes
     * @param order
     */
    async getCalculateCosts(orderDetails: OrderDetail[]) {
        let totalAmount : number = 0;
        let totalWeight : number = 0;
        let totalDiscount = 0;
        let totalRevenue = 0;
        orderDetails.map(item => {
            totalWeight += Number(item.weight) * Number(item.quantity);
            if (item.discountPercent > 0) {
                totalDiscount += ((Number(item.price) * Number(item.discountPercent)) / 100) * Number(item.quantity);
            } else {
                totalDiscount = 0;
            }
            totalAmount += Number(item.price) * Number(item.quantity);
            totalRevenue += Number(item.revenue);
        });

        return {
            totalAmount,
            totalWeight,
            totalDiscount,
            totalRevenue
        };
    }

    async getDetails(order: Order): Promise<OrderDetail[]> {
        return await this.orderDetailRepository.createQueryBuilder('orderDetail')
            .where('orderDetail.order = :value', {value: order.id})
            .leftJoinAndSelect('orderDetail.product', 'p')
            .leftJoinAndSelect('p.productImage', 'pi')
            .leftJoinAndMapOne('orderDetail.productSize', ProductSize,'ps', 'ps.color = orderDetail.color and ps.name = orderDetail.size and ps.product = orderDetail.product')
            .innerJoin('orderDetail.product', 'product')
            .getMany();
    }

    async getOrderDetailByProductIdAndStatuses(productId, orderStatus: any) {
        return await this.orderDetailRepository.createQueryBuilder('orderDetail')
            .addSelect('SUM(orderDetail.quantity)', 'quantity')
            .leftJoinAndSelect('orderDetail.product', 'p')
            .leftJoinAndSelect('orderDetail.order', 'o')
            .leftJoinAndSelect('o.customer', 'c')
            .where('orderDetail.product = :product', {product: productId})
            .andWhere('o.status IN (:orderStatus)', {orderStatus: orderStatus})
            .addGroupBy('o.id')
            .addGroupBy('p.id')
            .getMany();
    }

    /** Descontar de inventario (Creacion de producto) */
    async updateInventaryForOrderDetail(orderDetails: OrderDetail[], increment = false) {
        await Promise.all(orderDetails.map(async item => {
            const orderDetail: OrderDetail = item;
            await this.productSizeService.updateInventary(orderDetail, increment ? orderDetail.quantity : orderDetail.quantity * -1);
        }));
    }

    /**
     * @param Order order
     * Obtener plantilla dependiendo de la orden
     */
    getBoardRuleTemplate(order: Order) {
        const aliasFree = order.orderDelivery.deliveryCost == 0 ? 'FREE' : 'PAID';
        const deliveryTemplateName = `COPY_RESUME_${getDeliveryType(order.orderDelivery.deliveryType)}_${order.deliveryMethod.code}_${aliasFree}`;
        return deliveryTemplateName;
    }

    /**
     * @param Order order
     * Obtener plantilla dependiendo de la orden
     */
    async getOrderStatsByStatus() {

        let _today = new Date();

        const pendings = await this.orderRepository.createQueryBuilder('o')
            .select('COUNT(o.id) as quantity')
            .where("o.status = (:_status)", {_status: OrderStatus.PENDING})
            .andWhere("DATE(o.createdAt) >= DATE(:_date)", {_date: _today})
            //.groupBy("o.status")
            .getRawMany();

        const confirmed = await this.orderRepository.createQueryBuilder('o')
            .select('COUNT(o.id) as quantity')
            .where("o.status = (:_status)", {_status: OrderStatus.CONFIRMED})
            .andWhere("DATE(o.createdAt) >= DATE(:_date)", {_date: _today})
            //.groupBy("o.status")
            .getRawMany();

        const reconcilied = await this.orderRepository.createQueryBuilder('o')
            .select('COUNT(o.id) as quantity')
            .where("o.status = (:_status)", {_status: OrderStatus.RECONCILED})
            .andWhere("DATE(o.createdAt) >= DATE(:_date)", {_date: _today})
            //.groupBy("o.status")
            .getRawMany();

        const printed = await this.orderRepository.createQueryBuilder('o')
            .select('COUNT(o.id) as quantity')
            .where("o.status = (:_status)", {_status: OrderStatus.PRINTED})
            .andWhere("DATE(o.createdAt) >= DATE(:_date)", {_date: _today})
            //.groupBy("o.status")
            .getRawMany();

        const cancelled = await this.orderRepository.createQueryBuilder('o')
            .select('COUNT(o.id) as quantity')
            .where("o.status = (:_status)", {_status: OrderStatus.CANCELED})
            .andWhere("DATE(o.createdAt) >= DATE(:_date)", {_date: _today})
            //.groupBy("o.status")
            .getRawMany();

        return {
            pending: pendings[0] && pendings[0].quantity || 0,
            confirmed: confirmed[0] && confirmed[0].quantity || 0,
            reconcilied: reconcilied[0] && reconcilied[0].quantity || 0,
            printed: printed[0] && printed[0].quantity || 0,
            cancelled: cancelled[0] && cancelled[0].quantity || 0
        };

    }

    /**
     * @param Order order
     * Registrar un cliente mayorista desde ordenes
     */
    async addMayorist(order: Order, updateEntity: boolean = false, refresh = false, customer = Customer) : Promise<boolean>{

        const numberOfItemsMayorist = 6;
        const lastMayoristHistory = 2;

        let orders : Order[] = await this.orderRepository.createQueryBuilder(Order.name)
            .select("*")
            .where({
                customer: order.customer,
            })
            .andWhere('status IN (:statuses)')
            .setParameter('statuses', isSell())
            .limit(lastMayoristHistory)
            .orderBy('created_at', OrderConditional.DESC).getMany();

        let mayoristHistory = 0;

        if(order.quantity >= numberOfItemsMayorist){
            mayoristHistory++;
        }

        if(orders){
            orders.map(item => {
                if(item.quantity >= numberOfItemsMayorist){
                    mayoristHistory++;
                }
            })
        }

        if(order && order.customer) {
            if (mayoristHistory > 1 && updateEntity) {
                order.customer.isMayorist = true;
                await this.customerService.createOrUpdate(order.customer);
            } else {
                order.customer.isMayorist = false;
                await this.customerService.createOrUpdate(order.customer);
            }
        }
        return mayoristHistory > 0;
    }

    /**
     * @param Order order
     * Obtener plantilla dependiendo de la orden
     */
    getExportOfficeReport(order: Order) {
        const deliveryTemplateName = `EXPORT_OFFICE_${order.deliveryMethod.code}`;
        return deliveryTemplateName;
    }

    async findByIds(orderIds: any) {
        return await this.orderRepository.createQueryBuilder('o')
            .leftJoinAndSelect('o.orderDelivery', 'od')
            .leftJoinAndSelect('o.deliveryMethod', 'dm')
            .where('o.id IN (:orderIds)', {orderIds: orderIds})
            .getMany();
    }

    async findByIdsWithFullRelations(orderIds: any) {
        return await this.orderRepository.createQueryBuilder('o')
            .where('o.id IN (:orderIds)', {orderIds: orderIds})
            .leftJoinAndSelect('o.orderDelivery', 'od')
            .leftJoinAndSelect('o.customer', 'cu')
            .leftJoinAndSelect('o.deliveryMethod', 'dm')
            .getMany();
    }

    /** Update orders */
    async updateOffices(office: Office, condition){
        return await this.orderRepository.createQueryBuilder('o')
            .update(Order)
            .set({ office: office })
            .where(condition)
            .execute();
    }

    /** Remove office */
    async removeOffice(orderId){
        return await this.orderRepository.createQueryBuilder('o')
            .update(Order)
            .set({ office: null })
            .where({id: orderId})
            .execute();
    }

    /** Reporte basado en envio de Ordenes */
    async findByDelivery(dateFrom, dateTo, deliveryMethod, status){

        return await this.orderRepository.createQueryBuilder('o')
            .leftJoinAndSelect('o.customer', 'c')
            .leftJoinAndSelect('c.municipality', 'm')
            .leftJoinAndSelect('c.state', 's')
            .leftJoinAndSelect('o.orderDelivery', 'd')
            .leftJoinAndSelect('o.deliveryMethod', 'i')
            .andWhere("DATE(d.deliveryDate) >= :before", {before: toDateFormat(dateFrom)})
            .andWhere("DATE(d.deliveryDate) <= :after", {after: toDateFormat(dateTo)})
            .andWhere("o.deliveryMethod = :deliveryMethod", {deliveryMethod: deliveryMethod})
            .andWhere("o.status = :status", {status: status})
            .orderBy('d.deliveryDate', 'ASC')
            .limit(8000)
            .getMany();
    }

    /** Reporte Conciliados */
    async findOrderConciliates(dateFrom, dateTo, deliveryMethod){
        return await this.orderRepository.createQueryBuilder('o')
            .leftJoinAndSelect('o.customer', 'c')
            .leftJoinAndSelect('o.orderDelivery', 'd')
            .leftJoinAndSelect('o.deliveryMethod', 'dm')
            .andWhere("d.deliveryType = :deliveryType")
            .andWhere("DATE(o.dateOfSale) >= :before", {before: toDateFormat(dateFrom)})
            .andWhere("DATE(o.dateOfSale) <= :after", {after: toDateFormat(dateTo)})
            .andWhere("dm.code = :deliveryMethod")
            .setParameters({deliveryType : DeliveryTypes.CHARGE_ON_DELIVERY, deliveryMethod})
            .getMany();
    }


    /** find order pending for update delivery status */
    /** Return Order */
    async findPendingForDelivery() : Promise<Order[]>{

        return await this.orderRepository.createQueryBuilder('o')
            .leftJoinAndSelect('o.orderDelivery', 'd')
            .leftJoinAndSelect('o.deliveryMethod', 'i')
            .where("o.orderDelivery", Not(IsNull()))
            .andWhere("d.sync = :sync", {sync: true})
            .andWhere("d.tracking", Not(IsNull()))
            .limit(60)
            .addOrderBy('d.syncDate', 'ASC')
            .getMany();
    }


    /** Obtener estadisticas de Ventas por Dia/Mes/Semana */
    async getStatsDay(dateFrom, dateTo, group, user, typeDate = 'sales'){

        const orderRepository = this.orderRepository.createQueryBuilder('o');

        if(typeDate === 'created'){
            typeDate = 'createdAt';
        } else {
            typeDate = 'dateOfSale';
        }

        switch(group) {
            case StatTimeTypes.DAILY:
                orderRepository.select(`SUM(o.totalWithDiscount) as monto, SUM(o.totalRevenue) as ganancia, SUM(o.quantity) as piezas, concat_ws("-",day(o.${typeDate}),month(o.${typeDate}),year(o.${typeDate})) as fecha, DATE(o.${typeDate}) as dateOrder`);
                orderRepository.addGroupBy(`year(o.${typeDate})`)
                orderRepository.addGroupBy(`month(o.${typeDate})`)
                orderRepository.addGroupBy(`day(o.${typeDate})`);
                break;
            case StatTimeTypes.WEEKLY:
                orderRepository.select(`SUM(o.totalWithDiscount) as monto, SUM(o.totalRevenue) as ganancia, SUM(o.quantity) as piezas, concat_ws("-",week(o.${typeDate},1),year(o.${typeDate})) as fecha, week(o.${typeDate}) as dateOrder`);
                orderRepository.addGroupBy(`year(o.${typeDate})`)
                orderRepository.addGroupBy(`week(o.${typeDate},1)`);
                break;
            case StatTimeTypes.MONTHLY:
                orderRepository.select(`SUM(o.totalWithDiscount) as monto, SUM(o.totalRevenue) as ganancia, SUM(o.quantity) as piezas, concat_ws("-",month(o.${typeDate}),year(o.${typeDate})) as fecha, MONTH(o.${typeDate}) as dateOrder`);
                orderRepository.addGroupBy(`year(o.${typeDate})`)
                orderRepository.addGroupBy(`month(o.${typeDate})`);
                break;
            case StatTimeTypes.YEARLY:
                orderRepository.select(`SUM(o.totalWithDiscount) as monto, SUM(o.totalRevenue) as ganancia, SUM(o.quantity) as piezas, year(o.${typeDate}) as fecha, DATE(o.${typeDate}) as dateOrder, YEAR(o.${typeDate}) as dateOrder`);
                orderRepository.addGroupBy(`year(o.${typeDate})`);
                break;
        }

        if(user != null){
            orderRepository.leftJoinAndSelect('o.user', 'u')
                .where("u.id = :user")
                .andWhere(`DATE(o.${typeDate}) >= :before`)
                .andWhere(`DATE(o.${typeDate}) <= :after`)
                .addGroupBy('o.user')
                .addOrderBy('dateOrder', 'ASC')
                .setParameters({before: dateFrom, after: dateTo, user: user['id'], statuses: [OrderStatus.RECONCILED, OrderStatus.FINISHED]});
        } else {
            orderRepository.andWhere(`DATE(o.${typeDate}) >= :before`);
            orderRepository.andWhere(`DATE(o.${typeDate}) <= :after`);
            orderRepository.addOrderBy('dateOrder', 'ASC');
            orderRepository.setParameters({before: dateFrom + " 00:00:00", after: dateTo + " 23:59:59", statuses: [OrderStatus.RECONCILED, OrderStatus.FINISHED]});
        }

        if(typeDate === 'createdAt'){
            orderRepository.andWhere('o.status IN (:statuses)')
        }

        const rows = await orderRepository.getRawMany();

        let results = [];

        rows.map(item => {
           results.push({
               fecha: item["fecha"],
               monto: parseFloat(item["monto"]),
               ganancia: parseFloat(item["ganancia"]),
               piezas: parseFloat(item["piezas"])
           });
        });

        rows.sort(function(a, b) {
            var x = a['dateOrder'];
            var y = b['dateOrder'];
            return ((x < y) ? -1 : ((x > y) ? 1 : 0));
        });

        return results;
    }

    /** Obtener estadisticas de Ventas por Dia/Mes/Semana */
    async getStatsDaybyStatus(dateFrom, dateTo, group, user){

        const orderPendingRepository = this.orderRepository.createQueryBuilder('o');
        const orderConfirmedRepository = this.orderRepository.createQueryBuilder('o');
        const orderSentRepository = this.orderRepository.createQueryBuilder('o');
        const orderFinishedRepository = this.orderRepository.createQueryBuilder('o');
        const orderCanceledRepository = this.orderRepository.createQueryBuilder('o');

        const repositories = [orderPendingRepository,orderConfirmedRepository,orderSentRepository,orderFinishedRepository,orderCanceledRepository];
        const statuses = [OrderStatus.PENDING,OrderStatus.CONFIRMED,OrderStatus.SENT, OrderStatus.FINISHED, OrderStatus.CANCELED];


        const typeDate = 'createdAt';

        switch(group) {
            case StatTimeTypes.DAILY:
                repositories.forEach(repo => {
                    repo.select(`SUM(o.totalWithDiscount) as monto, SUM(o.totalRevenue) as ganancia, SUM(o.quantity) as piezas, concat_ws("-",day(o.${typeDate}),month(o.${typeDate}),year(o.${typeDate})) as fecha, DATE(o.${typeDate}) as dateOrder, o.status as status`);
                    repo.addGroupBy(`year(o.${typeDate})`)
                    repo.addGroupBy(`month(o.${typeDate})`)
                    repo.addGroupBy(`day(o.${typeDate})`);
                    repo.addGroupBy(`o.status`);
                })
                break;
            case StatTimeTypes.WEEKLY:
                repositories.forEach(repo => {
                    repo.select(`SUM(o.totalWithDiscount) as monto, SUM(o.totalRevenue) as ganancia, SUM(o.quantity) as piezas, concat_ws("-",week(o.${typeDate},1),year(o.${typeDate})) as fecha, week(o.${typeDate}) as dateOrder, o.status as status`);
                    repo.addGroupBy(`year(o.${typeDate})`)
                    repo.addGroupBy(`week(o.${typeDate},1)`);
                    repo.addGroupBy(`o.status`);
                });
                break;
            case StatTimeTypes.MONTHLY:
                repositories.forEach(repo => {
                    repo.select(`SUM(o.totalWithDiscount) as monto, SUM(o.totalRevenue) as ganancia, SUM(o.quantity) as piezas, concat_ws("-",month(o.${typeDate}),year(o.${typeDate})) as fecha, MONTH(o.${typeDate}) as dateOrder, o.status as status`);
                    repo.addGroupBy(`year(o.${typeDate})`)
                    repo.addGroupBy(`month(o.${typeDate})`);
                    repo.addGroupBy(`o.status`);
                });
                break;
            case StatTimeTypes.YEARLY:
                repositories.forEach(repo => {
                    repo.select(`SUM(o.totalWithDiscount) as monto, SUM(o.totalRevenue) as ganancia, SUM(o.quantity) as piezas, year(o.${typeDate}) as fecha, DATE(o.${typeDate}) as dateOrder, YEAR(o.${typeDate}) as dateOrder, o.status as status`);
                    repo.addGroupBy(`year(o.${typeDate})`);
                    repo.addGroupBy(`o.status`);
                });
                break;
        }

        if(user != null){
            repositories.forEach((repo,index) => {
                repo.leftJoinAndSelect('o.user', 'u')
                    .where("u.id = :user")
                    .andWhere(`DATE(o.${typeDate}) >= :before`)
                    .andWhere(`DATE(o.${typeDate}) <= :after`)
                    .andWhere(`o.status = :status`)
                    .addGroupBy('o.user')
                    .addOrderBy('dateOrder', 'ASC')
                    .setParameters({before: dateFrom, after: dateTo, user: user['id'], status: statuses[index + '']});
            });
        } else {
            repositories.forEach((repo,index) => {
                repo.andWhere(`DATE(o.${typeDate}) >= :before`);
                repo.andWhere(`DATE(o.${typeDate}) <= :after`);
                repo.andWhere(`o.status = :status`)
                repo.addOrderBy('dateOrder', 'ASC');
                repo.setParameters({before: dateFrom + " 00:00:00", after: dateTo + " 23:59:59", status: statuses[index + '']});
            });
        }


        let allStatus = await Promise.all(repositories.map(async repo => {
            const rows = await repo.getRawMany();

            rows.sort(function(a, b) {
                var x = a['dateOrder'];
                var y = b['dateOrder'];
                return ((x < y) ? -1 : ((x > y) ? 1 : 0));
            });

            return rows;
        }));

        let results = {};
        let new_results = [];
        allStatus.forEach((_status, index) => {

            _status.forEach(item => {
                console.log('item: ', item);

                if(!!!results[item['fecha']]){
                    results[item['fecha']] = {
                        fecha: item["fecha"],
                        [OrderStatus.PENDING.toString()]: '0',
                        [OrderStatus.CONFIRMED.toString()]: '0',
                        [OrderStatus.SENT.toString()]: '0',
                        [OrderStatus.FINISHED.toString()]: '0',
                        [OrderStatus.CANCELED.toString()]: '0'
                    };
                }

                results[item['fecha']][[item['status'] + '']] = item["monto"];
            });

            new_results = Object.keys(results).map(function (key) {
                return results[key];
            });
        });

        return new_results;
    }

    /** Obtener estadisticas de Ventas por Estados */

    async getStatsOrigen(dateFrom, dateTo, group){

        const orderRepository = this.orderRepository.createQueryBuilder('o');
        const options = await this.fieldOptionService.findByGroup('ORDERS_ORIGIN');

        orderRepository.addSelect("o.totalWithDiscount");
        orderRepository.addSelect("SUM(IF(LOWER(o.origen) LIKE 'whatsapp%', o.totalWithDiscount,0))", "Whatsapp");
        options.map(item => {
            if(!(item.value.toLowerCase().includes("whatsapp"))) {
                orderRepository.addSelect("SUM(IF(o.origen='" + item.value + "', o.totalWithDiscount,0))", string_to_slug(item.value));
            }
        });

        switch(group) {
            case StatTimeTypes.DAILY:
                orderRepository.addSelect("CONCAT_WS('-',day(o.dateOfSale),month(o.dateOfSale),year(o.dateOfSale))", 'fecha');
                orderRepository.addSelect("DATE(o.dateOfSale)", 'dateOrder');
                orderRepository.addGroupBy("YEAR(o.dateOfSale)")
                orderRepository.addGroupBy("MONTH(o.dateOfSale)")
                orderRepository.addGroupBy("DAY(o.dateOfSale)");
                orderRepository.addOrderBy("DATE(o.dateOfSale)");
                break;
            case StatTimeTypes.WEEKLY:
                orderRepository.addSelect("WEEK(o.dateOfSale,1) as semana, year(o.dateOfSale) as ano, CONCAT_WS('-',week(o.dateOfSale,1),year(o.dateOfSale))", 'fecha');
                orderRepository.addSelect("CONCAT_WS('-',week(o.dateOfSale,1),year(o.dateOfSale))", 'dateOrder');
                orderRepository.addGroupBy("YEAR(o.dateOfSale)")
                orderRepository.addGroupBy("WEEK(o.dateOfSale,1)");
                orderRepository.addOrderBy("YEAR(o.dateOfSale)");
                orderRepository.addOrderBy("WEEK(o.dateOfSale,1)");
                break;
            case StatTimeTypes.MONTHLY:
                orderRepository.addSelect("CONCAT_WS('-',month(o.dateOfSale),year(o.dateOfSale))", 'fecha');
                orderRepository.addSelect("CONCAT_WS('-',month(o.dateOfSale),year(o.dateOfSale))", 'dateOrder');
                orderRepository.addGroupBy("YEAR(o.dateOfSale)")
                orderRepository.addGroupBy("MONTH(o.dateOfSale)");
                orderRepository.addOrderBy("YEAR(o.dateOfSale)");
                orderRepository.addOrderBy("MONTH(o.dateOfSale)");
                break;
            case StatTimeTypes.YEARLY:
                orderRepository.addSelect("YEAR(o.dateOfSale)", 'fecha');
                orderRepository.addSelect("YEAR(o.dateOfSale)", 'dateOrder');
                orderRepository.groupBy("YEAR(o.dateOfSale)")
                orderRepository.orderBy("YEAR(o.dateOfSale)");
                break;
        }

        orderRepository.andWhere("DATE(o.dateOfSale) >= :before");
        orderRepository.andWhere("DATE(o.dateOfSale) <= :after");

        orderRepository.setParameters({before: dateFrom + " 00:00:00", after: dateTo + " 23:59:59"});

        const rows = await orderRepository.getRawMany();



        let results = [];

        rows.map(item => {

            let modified = {};
            options.map(origenItem => {
                if(!(origenItem.name.toLowerCase().includes("whatsapp"))) {
                    modified[origenItem.name] = parseFloat(item[string_to_slug(origenItem.value)]);
                }
            });

            modified["Whatsapp"] = parseFloat(item["Whatsapp"]);

            results.push({
                fecha: item['fecha'],
                ...modified
            })

        });

        rows.sort(function(a, b) {
            var x = a['dateOrder'];
            var y = b['dateOrder'];
            return ((x < y) ? -1 : ((x > y) ? 1 : 0));
        });

        return results;

    }

    /** Obtener estadisticas de Ventas por Estados */

    async getStatsTipo(dateFrom, dateTo, group){

        const orderRepository = this.orderRepository.createQueryBuilder('o');

        orderRepository.addSelect("o.totalWithDiscount");
        orderRepository.addSelect("SUM(IF(d.deliveryType=1, 1,0))", "cantidadPrevioPago");
        orderRepository.addSelect("SUM(IF(d.deliveryType=1, o.totalWithDiscount,0))", "montoPrevioPago");
        orderRepository.addSelect("SUM(IF(d.deliveryType=3, 1,0))", "cantidadContraEntrega");
        orderRepository.addSelect("SUM(IF(d.deliveryType=3, o.totalWithDiscount,0))", "montoContraEntrega");
        orderRepository.leftJoin("o.orderDelivery", "d")


        switch(group) {
            case StatTimeTypes.DAILY:
                orderRepository.addSelect("CONCAT_WS('-',day(o.dateOfSale),month(o.dateOfSale),year(o.dateOfSale))", 'fecha');
                orderRepository.addGroupBy("YEAR(o.dateOfSale)")
                orderRepository.addGroupBy("MONTH(o.dateOfSale)")
                orderRepository.addGroupBy("DAY(o.dateOfSale)");
                orderRepository.addOrderBy("year(o.dateOfSale)");
                orderRepository.addOrderBy("month(o.dateOfSale)");
                orderRepository.addOrderBy("day(o.dateOfSale)");
                break;
            case StatTimeTypes.WEEKLY:
                orderRepository.addSelect("WEEK(o.dateOfSale,1) as semana, year(o.dateOfSale) as ano, CONCAT_WS('-',week(o.dateOfSale,1),year(o.dateOfSale))", 'fecha');
                orderRepository.addGroupBy("YEAR(o.dateOfSale)")
                orderRepository.addGroupBy("WEEK(o.dateOfSale,1)");
                orderRepository.addOrderBy("ano");
                orderRepository.addOrderBy("semana");
                break;
            case StatTimeTypes.MONTHLY:
                orderRepository.addSelect("CONCAT_WS('-',month(o.dateOfSale),year(o.dateOfSale))", 'fecha');
                orderRepository.addGroupBy("YEAR(o.dateOfSale)")
                orderRepository.addGroupBy("MONTH(o.dateOfSale)");
                orderRepository.addOrderBy("YEAR(o.dateOfSale)");
                orderRepository.addOrderBy("MONTH(o.dateOfSale)");
                break;
            case StatTimeTypes.YEARLY:
                orderRepository.addSelect("YEAR(o.dateOfSale)", 'fecha');
                orderRepository.groupBy("YEAR(o.dateOfSale)")
                orderRepository.orderBy("YEAR(o.dateOfSale)");
                break;
        }

        orderRepository.andWhere("DATE(o.dateOfSale) >= :before");
        orderRepository.andWhere("DATE(o.dateOfSale) <= :after");

        orderRepository.setParameters({before: dateFrom + " 00:00:00", after: dateTo + " 23:59:59"});

        const rows = await orderRepository.getRawMany();

        let results = [];

        rows.map(item => {
            results.push({
                fecha: item['fecha'],
                cantidadPrevioPago: item['cantidadPrevioPago'],
                montoPrevioPago: item['montoPrevioPago'],
                cantidadContraEntrega: item['cantidadContraEntrega'],
                montoContraEntrega: item['montoContraEntrega']
            });
        });

        return results;

    }

    async getStatsMasVendidos(dateFrom, dateTo) {
        const orderRepository = this.orderDetailRepository.createQueryBuilder('od');

        orderRepository.addSelect("p.reference", "id");
        orderRepository.addSelect("SUM(od.quantity)", "cantidad");
        orderRepository.addSelect("pa.quantity", "existencia");

        orderRepository.leftJoin("od.product", "p");
        orderRepository.leftJoin("p.viewAvailables", "pa");
        orderRepository.leftJoin("od.order", "o");

        orderRepository.andWhere("DATE(o.dateOfSale) >= :before");
        orderRepository.andWhere("DATE(o.dateOfSale) <= :after");

        orderRepository.andWhere("o.status IN (:status)");

        orderRepository.setParameters({before: dateFrom + " 00:00:00", after: dateTo + " 23:59:59", status: [OrderStatus.FINISHED, OrderStatus.PRINTED, OrderStatus.SENT]});

        orderRepository.groupBy("p.id")
        orderRepository.addOrderBy("SUM(od.quantity)", "DESC");
        orderRepository.limit(20);

        const rows = await orderRepository.getRawMany();

        return rows;

    }

    async getStatsHoras(dateFrom, dateTo) {

        const orderRepository = this.orderRepository.createQueryBuilder('o');

        orderRepository.addSelect("hour(o.createdAt)", "hora");
        orderRepository.addSelect("COUNT(*)", "cantidad");
        orderRepository.addSelect("SUM(o.totalWithDiscount)", "monto");

        orderRepository.where("DATE(o.createdAt) >= :before");
        orderRepository.andWhere("DATE(o.createdAt) <= :after");

        orderRepository.setParameters({before: dateFrom + " 00:00:00", after: dateTo + " 23:59:59"});

        orderRepository.groupBy("hora");

        const rows = await orderRepository.getRawMany();

        let results = [];

        for(let i=0; i<=23; i++){
            results.push({
                hora: i,
                monto: 0,
                cantidad: 0
            });
        }

        rows.map(item => {
            results[item["hora"]]['monto'] = item["monto"];
            results[item["hora"]]['cantidad'] = item["cantidad"];
        });

        return results;

    }

    async getStatsReincidencias(dateFrom, dateTo) {

        const orderRepository = this.orderRepository.createQueryBuilder('o');

        orderRepository.addSelect("COUNT(c.id)", "cantidad");


        orderRepository.where("DATE(o.dateOfSale) >= :before");
        orderRepository.andWhere("DATE(o.dateOfSale) <= :after");
        orderRepository.andWhere("o.status != :status");

        orderRepository.leftJoin("o.customer", "c");

        orderRepository.setParameters({before: dateFrom + " 00:00:00", after: dateTo + " 23:59:59", status: OrderStatus.CANCELED});

        orderRepository.groupBy("c.id");

        const rows = await orderRepository.getRawMany();

        let clientes = 0;
        let reincidentes = 0;

        rows.map(item => {
            clientes++;
            if(parseInt(item['cantidad']) > 1){
                reincidentes += parseInt(item['cantidad']);
            }
        });

        return {
            clientes: [clientes],
            reincidentes: [reincidentes]
        };

    }

    async getStatsEnvios(dateFrom, dateTo, group, withAmount){

        const orderRepository = this.orderRepository.createQueryBuilder('o')
            .leftJoinAndSelect('o.orderDelivery', 'd');

        orderRepository.addSelect("SUM(d.deliveryCost)", "sumCost");
        orderRepository.addSelect("COUNT(d.deliveryCost)", "qtyCost");


        switch(group) {
            case StatTimeTypes.DAILY:
                orderRepository.addSelect("CONCAT_WS('-',day(o.dateOfSale),month(o.dateOfSale),year(o.dateOfSale))", 'fecha');
                orderRepository.addGroupBy("YEAR(o.dateOfSale)")
                orderRepository.addGroupBy("MONTH(o.dateOfSale)")
                orderRepository.addGroupBy("DAY(o.dateOfSale)");
                orderRepository.addOrderBy("year(o.dateOfSale)");
                orderRepository.addOrderBy("month(o.dateOfSale)");
                orderRepository.addOrderBy("day(o.dateOfSale)");
                break;
            case StatTimeTypes.WEEKLY:
                orderRepository.addSelect("WEEK(o.dateOfSale,1) as semana, year(o.dateOfSale) as ano, CONCAT_WS('-',week(o.dateOfSale,1),year(o.dateOfSale))", 'fecha');
                orderRepository.addGroupBy("YEAR(o.dateOfSale)")
                orderRepository.addGroupBy("WEEK(o.dateOfSale,1)");
                orderRepository.addOrderBy("ano");
                orderRepository.addOrderBy("semana");
                break;
            case StatTimeTypes.MONTHLY:
                orderRepository.addSelect("CONCAT_WS('-',month(o.dateOfSale),year(o.dateOfSale))", 'fecha');
                orderRepository.addGroupBy("YEAR(o.dateOfSale)")
                orderRepository.addGroupBy("MONTH(o.dateOfSale)");
                orderRepository.addOrderBy("YEAR(o.dateOfSale)");
                orderRepository.addOrderBy("MONTH(o.dateOfSale)");
                break;
            case StatTimeTypes.YEARLY:
                orderRepository.addSelect("YEAR(o.dateOfSale)", 'fecha');
                orderRepository.groupBy("YEAR(o.dateOfSale)")
                orderRepository.orderBy("YEAR(o.dateOfSale)");
                break;
        }

        if(withAmount){
            orderRepository.andWhere("d.deliveryCost > 0");
        } else {
            orderRepository.andWhere("d.deliveryCost <= 0");
        }

        orderRepository.andWhere("DATE(o.dateOfSale) >= :before");
        orderRepository.andWhere("DATE(o.dateOfSale) <= :after");

        orderRepository.setParameters({before: dateFrom + " 00:00:00", after: dateTo + " 23:59:59"});

        const rows = await orderRepository.getRawMany();

        let results = [];

        rows.map(item => {
            results.push({
                fecha: item['fecha'],
                deliveryCosts: item['sumCost'],
                deliveryQty: item['qtyCost']
            });
        });

        return results;

    }

    async getStatsWhatsapp(dateFrom, dateTo) {
        const orderRepository = this.orderRepository.createQueryBuilder('o');
        orderRepository.addSelect("o.origen");
        orderRepository.addSelect("SUM(o.totalWithDiscount) as monto");
        orderRepository.where("o.origen LIKE :origen");
        orderRepository.andWhere("DATE(o.dateOfSale) >= :before");
        orderRepository.andWhere("DATE(o.dateOfSale) <= :after");

        orderRepository.setParameters({origen: "%WHATSAPP%", before: dateFrom + " 00:00:00", after: dateTo + " 23:59:59"});
        orderRepository.groupBy("o.origen");
        orderRepository.addOrderBy('LENGTH(o.origen)', 'ASC');
        orderRepository.addOrderBy('o.origen', 'ASC');

        const rows = await orderRepository.getRawMany();

        let results = [];

        rows.map(item => {
            results.push({
                origen: item["origen"],
                monto: parseFloat(item["monto"])
            });
        });

        return results;

    }

    /** Obtener estadisticas de Ventas por Estados */

    async getStatsStates(dateFrom, dateTo){

            const orderRepository = this.orderRepository.createQueryBuilder('o');

            orderRepository.leftJoin('o.customer', 'c');
            orderRepository.leftJoin('c.state', 's');
            orderRepository.select('SUM(o.totalWithDiscount) as monto')
            orderRepository.addSelect('s.name', 'estado')

            orderRepository.andWhere("DATE(o.dateOfSale) >= :before");
            orderRepository.andWhere("DATE(o.dateOfSale) <= :after");

            orderRepository.groupBy("c.state");

            orderRepository.addOrderBy('s.name', 'ASC');

            orderRepository.setParameters({before: dateFrom + ' 00:00:00', after: dateTo + ' 23:59:59'});

            const rows = await orderRepository.getRawMany();

            let results = [];

            rows.map(item => {
                results.push({
                    estado: item["estado"],
                    monto: parseFloat(item["monto"])
                });
            });

            return results;

    }


    async getStatDashboard(){

        let statDailyFirst;
        let statDailySecond;
        let statWeeklyFirst;
        let statWeeklySecond;

            const firstDate = moment().format('YYYY-MM-DD');
            const secondDate = moment().subtract(1, 'days').format('YYYY-MM-DD');

            statDailyFirst = await this.orderRepository.createQueryBuilder('o')
            .addSelect("SUM(o.totalWithDiscount)", "totalAmount")
            .addSelect("COUNT(o.id)", "totalQty")
            .andWhere("DATE(o.createdAt) = :date")
            .andWhere("o.status != :cancelled")
            .setParameters({date: firstDate, cancelled: OrderStatus.CANCELED})
            .groupBy('DATE(o.createdAt)')
            .getRawOne();

            statDailySecond = await this.orderRepository.createQueryBuilder('o')
            .addSelect("SUM(o.totalWithDiscount)", "totalAmount")
            .addSelect("COUNT(o.id)", "totalQty")
            .andWhere("DATE(o.createdAt) = :date")
            .andWhere("o.status != :cancelled")
            .setParameters({date: secondDate, cancelled: OrderStatus.CANCELED})
            .groupBy('DATE(o.createdAt)')
            .getRawOne();


            const weekStart = moment().clone().weekday(0).format('YYYY-MM-DD');
            const weekEnd = moment().clone().weekday(6).format('YYYY-MM-DD');

            //const weekEnd = moment().format('YYYY-MM-DD');
            //const weekStart = moment().subtract(1, 'week').format('YYYY-MM-DD');

            const weekPastStart = moment().clone().weekday(-7).format('YYYY-MM-DD');
            const weekPastEnd = moment().clone().weekday(-1).format('YYYY-MM-DD');

            //const weekPastEnd = moment().subtract(1, 'week').format('YYYY-MM-DD');
            //const weekPastStart = moment().subtract(2, 'week').format('YYYY-MM-DD');

            statWeeklyFirst = await this.orderRepository.createQueryBuilder('o')
            .addSelect("COUNT(o.id)", "totalQty")
            .addSelect("SUM(o.totalWithDiscount)", "totalAmount")
            .andWhere("DATE(o.createdAt) >= :before", {before: weekStart})
            .andWhere("DATE(o.createdAt) <= :after", {after: weekEnd})
            .andWhere("o.status != :cancelled", {cancelled: OrderStatus.CANCELED})
            .getRawOne();

            statWeeklySecond = await this.orderRepository.createQueryBuilder('o')
            .addSelect("SUM(o.totalWithDiscount)", "totalAmount")
            .addSelect("COUNT(o.id)", "totalQty")
            .andWhere("DATE(o.createdAt) >= :before", {before: weekPastStart})
            .andWhere("DATE(o.createdAt) <= :after", {after: weekPastEnd})
            .andWhere("o.status != :cancelled", {cancelled: OrderStatus.CANCELED})
            .getRawOne();


        return {
            statDailyFirst: statDailyFirst ? parseFloat(statDailyFirst['totalAmount']) || 0 : 0,
            statDailyQtyFirst: statDailyFirst ? parseFloat(statDailyFirst['totalQty']) || 0 : 0,

            statDailySecond: statDailySecond ? parseFloat(statDailySecond['totalAmount']) || 0 : 0,
            statDailyQtySecond: statDailySecond ? parseFloat(statDailySecond['totalQty']) || 0 : 0,

            statWeeklyFirst: statWeeklyFirst ? parseFloat(statWeeklyFirst['totalAmount']) || 0 : 0,
            statWeeklyQtyFirst: statWeeklyFirst ? parseFloat(statWeeklyFirst['totalQty']) || 0 : 0,

            statWeeklySecond: statWeeklySecond ? parseFloat(statWeeklySecond['totalAmount']) || 0 : 0,
            statWeeklyQtySecond: statWeeklySecond ? parseFloat(statWeeklySecond['totalQty']) || 0 : 0,

        }
    }


    async getReservedFromProducts(products: number[]) : Promise<any>{
        const reserved = await this.orderDetailRepository.createQueryBuilder('od')
            .select('p.id, SUM(od.quantity) as quantity')
            .leftJoinAndSelect('od.product', 'p')
            .leftJoinAndSelect('od.order', 'o')
            .andWhere("p.id IN (:products)", {products: products})
            .andWhere("o.status = (:_status)", {_status: OrderStatus.PENDING})
            .groupBy("p.id")
            .getRawMany();

        if(reserved.length === 0){
            return [];
        }
        return reserved.map(_item => ({quantity: _item.quantity, id: _item.id}));
    }
//test
    async getCompletedFromProducts(products: number[]) : Promise<any>{
        const completed = await this.orderDetailRepository.createQueryBuilder('od')
            .select('p.id, SUM(od.quantity) as quantity')
            .leftJoinAndSelect('od.order', 'o')
            .leftJoinAndSelect('od.product', 'p')
            .leftJoinAndSelect('o.orderDelivery', 'd')
            .andWhere("p.id IN (:products)", {products: products})
            .andWhere("o.status IN (:_statuses)", {_statuses: [OrderStatus.RECONCILED, OrderStatus.CONFIRMED]})
            //.andWhere("d.deliveryType = (:_statusDelivery)", {_statusDelivery: 1})
            .groupBy("p.id")
            .getRawMany();

        if(completed.length === 0){
            return [];
        }
        return completed.map(_item => ({quantity: _item.quantity, id: _item.id}));
    }

}
