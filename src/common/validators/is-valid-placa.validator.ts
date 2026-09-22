import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Mesma regex que já era usada inline em CreateVehicleDto: aceita o formato
// Mercosul (ABC1D23) e o formato antigo (ABC1234 ou ABC-1234).
const REGEX_PLACA = /^([A-Z]{3}[0-9][A-Z][0-9]{2}|[A-Z]{3}-?[0-9]{4})$/;

@ValidatorConstraint({ name: 'IsValidPlaca' })
export class IsValidPlacaConstraint implements ValidatorConstraintInterface {
  validate(valor: unknown): boolean {
    if (typeof valor !== 'string') {
      return false;
    }
    return REGEX_PLACA.test(valor);
  }

  defaultMessage(): string {
    return 'Plate must be in Mercosul format (ABC1D23) or the old format (ABC1234 or ABC-1234)';
  }
}

export function IsValidPlaca(validationOptions?: ValidationOptions) {
  return function (objeto: object, nomeDaPropriedade: string) {
    registerDecorator({
      target: objeto.constructor,
      propertyName: nomeDaPropriedade,
      options: validationOptions,
      constraints: [],
      validator: IsValidPlacaConstraint,
    });
  };
}
