import {
    Column,
    Entity, JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from "typeorm";
import BaseModel from "../common/repositories/base.model";
import {
    IsDecimal,
    IsNumber,
} from "class-validator";
import {ProductSize} from "./ProductSize";
import {Order} from "./Order";
import {Product} from "./Product";
import {string_to_hex} from "../common/helper/helpers";

/**
 * El isImpress -> o Impreso seria un Estatus más,
 *
 */
@Entity({name: 'orderdetail'})
export class OrderDetail extends BaseModel{

    @PrimaryGeneratedColumn('increment')
    id: number;

    productSize: ProductSize

    @ManyToOne(() => Order)
    @JoinColumn({name: 'order_id'})
    order: Order;

    @ManyToOne(() => Product)
    @JoinColumn({name: 'product_id'})
    product: Product;

    @Column({name:'color', type: 'varchar', length: 800, nullable: true})
    color: string;

    @Column({name:'size', type: 'varchar', length: 100})
    size: string;

    @Column({name:'quantity', type: 'integer'})
    @IsNumber({}, {groups: ['create','update']})
    quantity: number;

    @Column({name:'price', type: 'decimal'})
    @IsDecimal({ decimal_digits: '2'}, {groups: ['create','update']})
    price: number;

    @Column({name:'cost', type: 'decimal', nullable: true, default: 0})
    @IsDecimal({ decimal_digits: '2'}, {groups: ['create','update']})
    cost: number;

    @Column({name:'revenue', type: 'decimal', nullable: true, default: 0})
    @IsDecimal({ decimal_digits: '2'}, {groups: ['create','update']})
    revenue: number;

    @Column({name:'weight', type: 'decimal', nullable: true, default: 0})
    @IsDecimal({ decimal_digits: '2'}, {groups: ['create','update']})
    weight: number;

    @Column({name:'discountPercent', type: 'decimal'})
    @IsDecimal({ decimal_digits: '4'}, {groups: ['create','update']})
    discountPercent: number;

    isEmpty(): boolean {
        return (this.id == null);
    }

    equals(orderDetail: OrderDetail): boolean {
        if(this.product.reference === orderDetail.product.reference &&
           this.size === orderDetail.size &&
           this.color === orderDetail.color){
            return true;
        }
        return false;
    }

    toHash() {
        const _string = this.color + this.size + this.quantity + this.price + this.product.id + this.discountPercent;
        const hash = string_to_hex(_string);
        return hash;
    }

    isProductSize(productSize: ProductSize){
        if(productSize){
            return (productSize.color === this.color && this.product.id === productSize.product.id && this.size === productSize.name);
        }
        return false;
    }

}
