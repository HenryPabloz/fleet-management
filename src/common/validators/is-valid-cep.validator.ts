import { Injectable } from '@nestjs/common';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ViaCepService } from '../../external/viacep/via-cep.service';

// Constraint assíncrona: chama a API do ViaCEP de verdade pra confirmar que o
// CEP existe. Campo vazio/undefined passa; quem decide se é obrigatório é o
// @IsOptional() (ou a ausência dele) no DTO.
@ValidatorConstraint({ name: 'IsValidCep', async: true })
@Injectable()
export class IsValidCepConstraint implements ValidatorConstraintInterface {
  constructor(private readonly viaCepService: ViaCepService) {}

  async validate(valor: unknown): Promise<boolean> {
    if (valor === undefined || valor === null || valor === '') {
      return true;
    }
    if (typeof valor !== 'string') {
      return false;
    }
    return this.viaCepService.cepEhValido(valor);
  }

  defaultMessage(args: ValidationArguments): string {
    return `CEP "${args.value}" inválido ou não encontrado`;
  }
}

export function IsValidCep(validationOptions?: ValidationOptions) {
  return function (objeto: object, nomeDaPropriedade: string) {
    registerDecorator({
      target: objeto.constructor,
      propertyName: nomeDaPropriedade,
      options: validationOptions,
      constraints: [],
      validator: IsValidCepConstraint,
    });
  };
}
