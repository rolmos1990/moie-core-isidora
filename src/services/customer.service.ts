import {BaseService} from "../common/controllers/base.service";
import {Customer} from "../models/Customer";
import {CustomerRepository} from "../repositories/customer.repository";
import {OrderRepository} from "../repositories/order.repository";
import {Order} from "../models/Order";
import {getAllStatus, isSell, OrderStatus} from "../common/enum/orderStatus";
import {OrderConditional} from "../common/enum/order.conditional";
import {OrderDetail} from "../models/OrderDetail";
import {OrderDetailRepository} from "../repositories/orderDetail.repository";
import moment = require("moment");

export class CustomerService extends BaseService<Customer> {
    constructor(
        private readonly customerRepository: CustomerRepository<Customer>,
        private readonly orderRepository: OrderRepository<Order>,
        private readonly orderDetailRepository: OrderDetailRepository<OrderDetail>
    ){
        super(customerRepository);
    }

    async findFull(id: any){
        return await this.find(id, ['state', 'municipality']);
    }

    async whereIn(customersId: []){
        const query = this.customerRepository.createQueryBuilder("c")
            .andWhere("c.id IN (:customers)")
            .setParameters({customers: customersId});
        const result = await query.getMany();
        return result;
    }


    async getOrdersFinishedForCustomers(customers: any){

        const params = {
            status: OrderStatus.FINISHED,
            customers: customers
        };

        const query = this.orderRepository.createQueryBuilder("o")
            .select("COUNT(o.id) as qty, c.id as id, c.name as name")
            .leftJoin('o.customer', 'c')
            .where("c.id IN (:customers)")
            .andWhere("o.status = :status")
            .groupBy('c.id')
            .setParameters(params);

        const result = await query.getRawMany();
        return result;
    }


    /** Obtener el historico de ultimas ordenes de un cliente */
    /** Customer null get all customers */
    /** Status null get by all status */
    /** beforeDate and afterDate are optionals */
    async getOrdersByProduct(customer: Customer, statuses: OrderStatus[] = getAllStatus(), beforeDate, afterDate, categoryMode = false){
        const query = this.orderDetailRepository.createQueryBuilder("orderDetail")
            .leftJoinAndSelect('orderDetail.product', 'p')
            .leftJoinAndSelect("orderDetail.order", "o");

        let params = {'statuses': statuses};

        if(customer){
            query.andWhere("o.customer = :customer");
            params['customer'] = customer.id;
        }
        if(beforeDate) {
            query.andWhere("DATE(o.createdAt) <= :before");
            params['before'] = beforeDate;
        }
        if(afterDate){
            query.andWhere("DATE(o.createdAt) >= :after");
            params['after'] = afterDate;
        }

        if(categoryMode){
            query.leftJoinAndSelect('p.category', 'c');
            query.groupBy("p.category");
            query.select("c.id as categoryId, SUM(orderDetail.price) as sumPrices, SUM(orderDetail.quantity) AS qty, c.name AS name");
        } else {
            query.groupBy("orderDetail.product");
            query.select("orderDetail.product as productId, SUM(orderDetail.price) as sumPrices, SUM(orderDetail.quantity) AS qty, p.name AS name");
        }

        query.andWhere('o.status IN (:statuses)')
        query.setParameters(params);

        const result = await query.getRawMany();
        return result;
    }


    /** Obtener cantidad de ordenes por estado en un cliente */
    async getOrdersStats(customer: Customer, statuses: OrderStatus[] = getAllStatus(), beforeDate, afterDate){
        const query = this.orderRepository.createQueryBuilder("o")

        let params = {'statuses': statuses};

        if(customer){
            query.andWhere("o.customer = :customer");
            params['customer'] = customer.id;
        }

        if(beforeDate) {
            query.andWhere("DATE(o.createdAt) <= :before");
            params['before'] = beforeDate;
        }
        if(afterDate){
            query.andWhere("DATE(o.createdAt) >= :after");
            params['after'] = afterDate;
        }

        query.groupBy("o.status");
        query.select("COUNT(o.status) as qty, o.status as status, SUM(o.total_amount) as sumPrices");

        query.andWhere('o.status IN (:statuses)')
        query.setParameters(params);

        return await query.getRawMany();
    }



    /** Obtener el historico de ultimas ordenes de un cliente */
    async getLastOrders(customer: Customer, statuses: OrderStatus[] = getAllStatus(), limit = 5){
        return this.orderRepository.createQueryBuilder(Order.name)
            .select("*")
            .where({
                customer: customer,
            })
            .andWhere('status IN :statuses')
            .setParameter('statuses', statuses)
            .limit(limit)
            .orderBy('createdAt', OrderConditional.DESC).getMany();
    }

    /** Obtener el historico de ultimas ordenes de un cliente */
    async getRegisteredsByRange(startDate, endDate){

        let parameters = [];
        parameters['before'] = startDate.toDate();
        parameters['after'] = endDate.toDate();

        const result = await this.customerRepository.createQueryBuilder("c")
            .where("DATE(c.createdAt) >= :before")
            .andWhere("DATE(c.createdAt) <= :after")
            .setParameters(parameters)
            .orderBy('createdAt', OrderConditional.DESC).getCount();
        return result;
    }


    async getStatDashboard(){

        const today = moment().format('YYYY-MM-DD');

        const registersToday = await this.customerRepository.createQueryBuilder('c')
            .addSelect("COUNT(c.id)", "registersToday")
            .where("DATE(c.createdAt) = :date", {date: today})
            .getRawOne();

        const registers = await this.customerRepository.createQueryBuilder('c')
            .addSelect("COUNT(c.id)", "registers")
            .getRawOne();

        return {registers: registers ? registers['registers'] : 0, registersToday: registersToday ? registersToday['registersToday'] : 0};
    }
}
