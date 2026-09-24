import { AppendixAKitSchema } from '../../graph/nodes/assembleNode';
import type { AppendixAKit } from '../../types/kit';

export function validateKit(finalKit: AppendixAKit): AppendixAKit {
  const validated = AppendixAKitSchema.parse(finalKit);

  if (validated.schedule.days.length !== validated.schedule.days_available) {
    throw new Error(
      `validateKit: schedule has ${validated.schedule.days.length} days but days_available=${validated.schedule.days_available}`
    );
  }

  return validated as AppendixAKit;
}
