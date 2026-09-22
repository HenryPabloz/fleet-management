import { IsInt, Min } from 'class-validator';

export class StartTripDto {
  @IsInt()
  @Min(0)
  currentMileage!: number;
}
