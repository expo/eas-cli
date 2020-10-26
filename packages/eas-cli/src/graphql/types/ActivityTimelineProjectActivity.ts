import { Actor } from './Actor';

export interface ActivityTimelineProjectActivity {
  id: string;
  actor: Actor;
  activityTimestamp: Date;
}
