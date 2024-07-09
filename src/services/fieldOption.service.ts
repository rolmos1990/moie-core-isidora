import {BaseService} from "../common/controllers/base.service";
import {FieldOption} from "../models/FieldOption";
import {FieldOptionRepository} from "../repositories/fieldOption.repository";

export class FieldOptionService extends BaseService<FieldOption> {
    constructor(
        private readonly fieldOptionRepository: FieldOptionRepository<FieldOption>
    ){
        super(fieldOptionRepository);
    }

    async findByName(name) : Promise<FieldOption>{
        return await this.fieldOptionRepository.findByObject({ name: name})[0];
    }
    async findByGroup(group): Promise<FieldOption[]>{
        return await this.fieldOptionRepository.findByObject({ groups: group});
    }

    async isAutoBilling(){
        try {
            const billingAuto = await this.findByGroup('BILLING_AUTOMATIC');
            const isAuto = billingAuto && JSON.parse(billingAuto[0].value);

            console.log('BILLING IS AUTO: ', isAuto == '1' || isAuto == 1);

            return (isAuto == '1' || isAuto == 1);
        }catch(e){
            console.log('BILLING IS AUTO: false');

            return false;
        }
    }
}

