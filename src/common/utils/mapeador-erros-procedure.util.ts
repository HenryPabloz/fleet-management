import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

// Traduz o erro de uma procedure do banco (RAISE EXCEPTION, sempre SQLSTATE
// P0001) para a exceção HTTP certa, seguindo a Seção 5.3 do DESIGN.
// Mensagens exatas (sem parte dinâmica): comparação direta.
const MENSAGENS_EXATAS: Record<string, number> = {
  'User not found': 400,
  'User is not active': 403,
  'Start location cannot be empty': 400,
  'End location cannot be empty': 400,
  'Location cannot be longer than 255 characters': 400,
  'Driver not found': 404,
  'Driver is not active': 409,
  'Driver user is not active': 409,
  'Driver license expired': 409,
  'Vehicle is required': 400,
  'Vehicle not found': 404,
  'Vehicle is not active': 409,
  'Vehicle is in use': 409,
  'Vehicle is under maintenance': 409,
  'Vehicle is out of service': 409,
  'Trip not found or not in PLANNED status': 409,
  'Trip does not belong to the informed vehicle': 400,
  'Current mileage exceeds the maximum allowed (10000000)': 400,
  'Trip not found or not in IN_PROGRESS status': 409,
  'End mileage cannot be less than start mileage': 400,
  'End mileage exceeds the maximum allowed (10000000)': 400,
  'End time must be after start time': 409,
  'Trip not found': 404,
  'Mileage must be greater than zero': 400,
  'Mileage exceeds the maximum allowed (10000000)': 400,
  'Liters must be greater than zero': 400,
  'Cost per liter must be greater than zero': 400,
  'Liters exceeds the maximum allowed (99999999.99)': 400,
  'Cost per liter exceeds the maximum allowed (999999.9999)': 400,
  'Total cost exceeds the maximum allowed (9999999999.99)': 400,
  'Invalid fuel type (use DIESEL, GASOLINE, ETHANOL or HYBRID)': 400,
  'Driver does not match the active trip of the vehicle': 409,
  'Invalid incident type (use ACCIDENT, MECHANICAL_FAILURE or OTHER)': 400,
  'Invalid severity (use LOW, MEDIUM or HIGH)': 400,
  'Description cannot be empty': 400,
  'Description cannot be longer than 1000 characters': 400,
  'Photo URL must start with http:// or https://': 400,
  'Photo URL cannot be longer than 500 characters': 400,
  'Photo key cannot be longer than 255 characters': 400,
  'Driver does not match the trip driver': 409,
  'Trip is not in IN_PROGRESS status': 409,
  // Triggers (disparam mesmo em escrita direta, não só via procedure)
  'Vehicle is not available (maintenance, out of service, or already in use)': 409,
  'Driver already has an active trip': 409,
  'Vehicle already has an active trip': 409,
  'Start kilometers cannot be negative': 400,
  'End kilometers cannot be negative': 400,
};

// Mensagens com número/status dinâmico no fim (ex: "... (15000)"): comparação por prefixo.
const PREFIXOS_DINAMICOS: Array<{ prefixo: string; status: number }> = [
  { prefixo: 'Current mileage cannot be less than vehicle current mileage (', status: 409 },
  { prefixo: 'End mileage cannot be less than vehicle current mileage (', status: 409 },
  { prefixo: 'Trip cannot be cancelled (status: ', status: 409 },
  { prefixo: 'Mileage cannot be less than vehicle current mileage (', status: 409 },
];

// Formato do erro que o driver adapter (@prisma/adapter-pg) devolve para um
// RAISE EXCEPTION do Postgres: cause.originalCode = 'P0001', cause.originalMessage = texto exato.
interface CausaDoDriverAdapter {
  originalCode?: string;
  originalMessage?: string;
  code?: string;
  message?: string;
}

function extrairMensagemDeProcedure(erro: unknown): string | null {
  if (!(erro instanceof Prisma.PrismaClientKnownRequestError)) {
    return null;
  }

  const meta = erro.meta as
    | { driverAdapterError?: { cause?: CausaDoDriverAdapter } }
    | undefined;
  const causa = meta?.driverAdapterError?.cause;

  if (!causa) {
    return null;
  }

  let codigoOriginal = causa.code;
  if (causa.originalCode) {
    codigoOriginal = causa.originalCode;
  }
  if (codigoOriginal !== 'P0001') {
    return null;
  }

  let mensagem = causa.message;
  if (causa.originalMessage) {
    mensagem = causa.originalMessage;
  }
  if (!mensagem) {
    return null;
  }
  return mensagem;
}

function statusParaMensagem(mensagem: string): number {
  if (mensagem in MENSAGENS_EXATAS) {
    return MENSAGENS_EXATAS[mensagem];
  }

  for (const item of PREFIXOS_DINAMICOS) {
    if (mensagem.startsWith(item.prefixo)) {
      return item.status;
    }
  }

  // Mensagem desconhecida: não sabemos o que aconteceu, então é erro interno.
  return 500;
}

function lancarExcecaoHttp(status: number, mensagem: string): never {
  if (status === 400) {
    throw new BadRequestException(mensagem);
  }
  if (status === 403) {
    throw new ForbiddenException(mensagem);
  }
  if (status === 404) {
    throw new NotFoundException(mensagem);
  }
  if (status === 409) {
    throw new ConflictException(mensagem);
  }
  throw new Error(mensagem);
}

// Chame dentro do catch de qualquer CALL de procedure (create_trip, start_trip,
// end_trip, cancel_trip, register_refueling, register_incident). Se o erro não
// for de uma procedure (P0001), relança o erro original sem mexer.
export function traduzirErroDeProcedure(erro: unknown): never {
  const mensagem = extrairMensagemDeProcedure(erro);

  if (mensagem === null) {
    throw erro;
  }

  const status = statusParaMensagem(mensagem);
  lancarExcecaoHttp(status, mensagem);
}
