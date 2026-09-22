import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Só regex, sem chamada externa: não precisa ser @Injectable() nem async,
// diferente do IsValidCep (que consulta a API do ViaCEP).
@ValidatorConstraint({ name: 'IsValidCnh' })
export class IsValidCnhConstraint implements ValidatorConstraintInterface {
  validate(valor: unknown): boolean {
    if (typeof valor !== 'string') {
      return false;
    }
    return /^[0-9]{11}$/.test(valor);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be exactly 11 digits (CNH format)`;
  }
}

export function IsValidCnh(validationOptions?: ValidationOptions) {
  return function (objeto: object, nomeDaPropriedade: string) {
    registerDecorator({
      target: objeto.constructor,
      propertyName: nomeDaPropriedade,
      options: validationOptions,
      constraints: [],
      validator: IsValidCnhConstraint,
    });
  };
}
