import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { IsValidCepConstraint } from '../../common/validators/is-valid-cep.validator';
import { ViaCepService } from './via-cep.service';

@Module({
  imports: [HttpModule],
  // IsValidCepConstraint também é registrado aqui: ele injeta o ViaCepService
  // e precisa estar visível para o container do Nest resolver o @IsValidCep().
  providers: [ViaCepService, IsValidCepConstraint],
  exports: [ViaCepService],
})
export class ViaCepModule {}
