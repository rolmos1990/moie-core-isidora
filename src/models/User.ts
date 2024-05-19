import {
    Column,
    CreateDateColumn,
    Entity, JoinColumn, ManyToOne, OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from "typeorm";
import BaseModel from "../common/repositories/base.model";
import {IsDate, IsEmail, Length, IsBoolean, IsDateString, IsMimeType} from "class-validator";
import { Type } from 'class-transformer';
import {OrderDetail} from "./OrderDetail";
import { Notification } from "./Notification";
import {SecurityRol} from "./SecurityRol";
import {Office} from "./Office";

@Entity({name: 'user'})
export class User extends BaseModel{
    @PrimaryGeneratedColumn('increment')
    id: number;

    @Column({type: 'varchar', length: 30})
    @Length(3, 30, {groups: ['create','update']})
    name: string;

    @Column({type: 'varchar', length: 30})
    @Length(3, 30, {groups: ['create','update']})
    lastname: string;

    @Column({name:'photo', type: 'text' })
    @Length(1, 100, {groups: ['create','update']})
    photo: string;

    @Column({type: 'varchar', length: 300, nullable: true})
    @Length(0, 300, {groups: ['create','update']})
    @IsEmail()
    email: string | null;

    @Column({type: 'varchar', length: 45})
    @Length(3, 45, {groups: ['create','update']})
    username: string;

    @Column({type: 'varchar', length: 300})
    @Length(3, 300, {groups: ['create']})
    password: string;

    @Column({type: 'varchar', length: 300})
    @Length(1, 300, {groups: ['create']})
    salt: string;

    @Column({type: 'boolean'})
    @IsBoolean({groups: ['create','update']})
    status: boolean;

    @Column({ name:'last_login', nullable: true })
    @Type(() => Date)
    @IsDate()
    lastLogin: Date;

    @CreateDateColumn({name:'created_at'})
    @Type(() => Date)
    @IsDate()
    createdAt: Date;

    @UpdateDateColumn({name:'updated_at', nullable: true})
    @Type(() => Date)
    @IsDate()
    updatedAt: Date;

    @ManyToOne(() => SecurityRol, { nullable: true })
    @JoinColumn({name: 'security_role_id'})
    securityRol: SecurityRol;

    @OneToMany(() => Notification, notifications => notifications.user)
    notifications: Notification[];

    @Column({type: 'varchar', length: 500})
    @Length(4, 500, {groups: ['create']})
    whatsapps: string;

    equals(obj: any) {
        if(obj instanceof User === false){
            return false;
        }
        if(obj.id === this.id){
            return true;
        }
        return false;
    }

    toString(){
        return User.toString();
    }

    isEmpty(){
        return (this.id == null);
    }
}
