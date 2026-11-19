export type MessagingCapabilities = {
  featureLevel: number;
  uploadMiB: number;
  messageLength: number;
  topicLength: number;
};
const values = new Map<string, MessagingCapabilities>();
export function setMessagingCapabilities(
  id: string,
  data: Record<string, unknown>,
) {
  const limit = (key: string, fallback: number) =>
    typeof data[key] === "number" &&
    Number.isFinite(data[key]) &&
    Number(data[key]) >= 0
      ? Number(data[key])
      : fallback;
  values.set(id, {
    featureLevel: limit("zulip_feature_level", 0),
    uploadMiB: limit("max_file_upload_size_mib", 0),
    messageLength: limit("max_message_length", 10000),
    topicLength: limit("max_topic_length", 60),
  });
}
export const messagingCapabilities = (id: string): MessagingCapabilities =>
  values.get(id) ?? {
    featureLevel: 0,
    uploadMiB: 0,
    messageLength: 10000,
    topicLength: 60,
  };
export function clearMessagingCapabilities(id: string) {
  values.delete(id);
}
