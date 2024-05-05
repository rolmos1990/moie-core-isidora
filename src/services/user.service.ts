import { User } from '../models/User';
import {UserRepository} from "../repositories/user.repository";
import {BaseService} from "../common/controllers/base.service";
import {InvalidArgumentException} from "../common/exceptions";
import { serverConfig } from '../config/ServerConfig';
import * as Bcrypt from "bcryptjs";
import * as Jwt from "jsonwebtoken";
import { UserListDTO } from "../controllers/parsers/user";

export class UserService extends BaseService<User> {
    constructor(
        private readonly userRepository: UserRepository<User>
    ){
        super(userRepository);
    }

    public async login(usernameOrEmail: string, password: string){
            if(!password || !usernameOrEmail){
                throw new InvalidArgumentException();
            }

            const user = await this.userRepository.findByUsername(usernameOrEmail);

            if (user.isEmpty() || !this.validatePassword(password, user.password)) {
                throw new InvalidArgumentException("Usuario y/o contraseña invalidos");
            }

            if(!user.status){
                throw new InvalidArgumentException("Usuario se encuentra bloqueado");
            }

            const token = this.generateToken(user);
            return {
                user: UserListDTO(user),
                token: token
            }
    }

    public async changePassword(usernameOrEmail: string, password: string){
        try {
            if (!password || !usernameOrEmail) {
                throw new InvalidArgumentException();
            }

            const user = await this.userRepository.findByUsername(usernameOrEmail);

            if(!user){
                throw new InvalidArgumentException("No hemos encontrado el usuario registrado");
            }
            try {
                await this.userRepository.changePassword(usernameOrEmail, password);
            }catch(e){
                throw new InvalidArgumentException("No hemos podido realizar la actualización de contraseña del usuario");
            }

            return {code: 200};
        }catch(e){
            return {code: 400, error: e.message};
        }
    }

    private validatePassword(requestPassword: string, accountPassword: string) {
        return Bcrypt.compareSync(requestPassword, accountPassword);
    }


    private generateToken(user: User) {
        const payload = { id: user.id, username: user.username };
        return Jwt.sign(payload, serverConfig.jwtSecret, { expiresIn: serverConfig.jwtExpiration });
    }
}
