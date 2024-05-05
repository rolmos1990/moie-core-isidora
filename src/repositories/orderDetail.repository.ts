import BaseRepository from "../common/repositories/base.repository";
import {getRepository, Repository} from "typeorm";
import {OrderDetail} from "../models/OrderDetail";
import {Order} from "../models/Order";

export class OrderDetailRepository<T> extends BaseRepository<OrderDetail>{
    protected readonly repositoryManager : Repository<OrderDetail>;

    constructor(){
        super();
        this.repositoryManager = getRepository(OrderDetail);
    }

    async deleteFrom(order: Order){
        await this.repositoryManager.delete({ order: order });
    }
}
