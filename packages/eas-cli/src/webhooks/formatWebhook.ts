import { WebhookFragment } from '../graphql/generated';
import formatFields from '../utils/formatFields';

export function formatWebhook(webhook: WebhookFragment): string {
  return formatFields([
    { label: 'ID', value: webhook.id },
    { label: 'Event', value: webhook.event },
    { label: 'URL', value: webhook.url },
    { label: 'Created at', value: new Date(webhook.createdAt).toLocaleString() },
    { label: 'Updated at', value: new Date(webhook.updatedAt).toLocaleString() },
  ]);
}
