import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

// Barra nomes com números (ex: "Joao123"), só deixa passar letras/espaços/acentos.
@Injectable()
export class NomePipe implements PipeTransform<string, string> {
  transform(valor: string): string {
    // Campo opcional (PATCH): sem valor, não há o que validar.
    if (valor === undefined || valor === null) {
      return valor;
    }

    const contemNumero = /\d/.test(valor);

    if (contemNumero) {
      throw new BadRequestException('O nome não pode conter números.');
    }

    return valor;
  }
}
