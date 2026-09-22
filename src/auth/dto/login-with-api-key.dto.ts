import { LoginDto } from './login.dto';

// Mesmos campos do LoginDto; precisa da classe para o ValidationPipe validar.
export class LoginWithApiKeyDto extends LoginDto {}
