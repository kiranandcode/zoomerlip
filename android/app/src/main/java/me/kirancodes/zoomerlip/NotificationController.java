package me.kirancodes.zoomerlip;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.webkit.JavaScriptReplyProxy;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/** Local notifications only. No credentials, push token, receiver or background service. */
final class NotificationController {
    static final String MESSAGES = "zoomerlip.messages.v1", QUIET = "zoomerlip.quiet.v1";
    static final String OPEN = "me.kirancodes.zoomerlip.OPEN_NOTIFICATION", TOKEN = "notification_token";
    static final int PERMISSION_REQUEST = 30;
    private final Activity activity;
    private final NotificationManager manager;
    private final SharedPreferences preferences;
    private JavaScriptReplyProxy permissionReply;
    private JSONObject pending;
    NotificationController(Activity activity) {
        this.activity = activity;
        manager = activity.getSystemService(NotificationManager.class);
        preferences = activity.getSharedPreferences("notification_routes", Activity.MODE_PRIVATE);
        NotificationChannel messages = new NotificationChannel(MESSAGES, "Messages", NotificationManager.IMPORTANCE_DEFAULT);
        messages.setDescription("Messages received while Zoomerlip is running");
        messages.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        NotificationChannel quiet = new NotificationChannel(QUIET, "Silent messages", NotificationManager.IMPORTANCE_LOW);
        quiet.setSound(null, null); quiet.enableVibration(false); quiet.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(messages); manager.createNotificationChannel(quiet);
    }
    static boolean validAccount(String id) {
        if (id == null || id.length() > 2048) return false;
        int split = id.lastIndexOf('|');
        if (split < 0 || !id.substring(split + 1).matches("[1-9][0-9]*")) return false;
        try {
            java.net.URI uri = new java.net.URI(id.substring(0, split));
            return "https".equals(uri.getScheme()) && uri.getHost() != null && uri.getRawUserInfo() == null
                && uri.getRawQuery() == null && uri.getRawFragment() == null && (uri.getRawPath() == null || uri.getRawPath().isEmpty());
        } catch (Exception ignored) { return false; }
    }
    private Set<String> accounts() { return new HashSet<>(preferences.getStringSet("accounts", java.util.Collections.emptySet())); }
    static String tag(String account, long message) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(account.getBytes(StandardCharsets.UTF_8));
            StringBuilder text = new StringBuilder("zoomerlip:");
            for (byte b : digest) text.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            return text + ":" + message;
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
    // MainActivity installs this listener only when WEB_MESSAGE_LISTENER is supported.
    @android.annotation.SuppressLint("RequiresFeature")
    void handle(String raw, JavaScriptReplyProxy reply) {
        if (raw == null || raw.length() > 16384) return;
        try {
            JSONObject data = new JSONObject(raw);
            String op = data.getString("op");
            if (op.equals("accounts")) {
                JSONArray list = data.getJSONArray("accounts"); if (list.length() > 64) return;
                Set<String> next = new HashSet<>();
                for (int i = 0; i < list.length(); i++) { String id = list.getString(i); if (!validAccount(id)) return; next.add(id); }
                for (String old : accounts()) if (!next.contains(old)) clear(old);
                preferences.edit().putStringSet("accounts", next).apply();
                if (pending != null && !next.contains(pending.optString("accountId"))) pending = null;
                return;
            }
            if (op.equals("permission")) {
                if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    permissionReply = reply;
                    activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQUEST);
                } else permissionResult(reply);
                return;
            }
            if (op.equals("settings")) {
                activity.startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName())); return;
            }
            if (op.equals("ready")) {
                if (pending != null && accounts().contains(pending.optString("accountId"))) { reply.postMessage(pending.toString()); pending = null; }
                permissionResult(reply); return;
            }
            String account = data.getString("accountId");
            if (!accounts().contains(account)) return;
            if (op.equals("clear")) { clear(account); return; }
            long message = data.getLong("messageId"); if (message <= 0 || message > 9007199254740991L) return;
            if (op.equals("cancel")) { cancel(account, message); return; }
            if (op.equals("show")) show(account, message, data.optString("title", "Zoomerlip"), data.optString("body", "New message"), data.optBoolean("sound"));
        } catch (Exception ignored) { /* Invalid requests cannot expand bridge capabilities. */ }
    }
    // A reply proxy exists only after the feature-gated listener receives a message.
    @android.annotation.SuppressLint("RequiresFeature")
    void permissionResult(JavaScriptReplyProxy reply) {
        if (reply == null) return;
        reply.postMessage("{\"permission\":\"" + (manager.areNotificationsEnabled() ? "granted" : "denied") + "\"}");
    }
    void permissionResult() { permissionResult(permissionReply); permissionReply = null; }
    void show(String account, long message, String title, String body, boolean sound) throws Exception {
        if (!accounts().contains(account) || !manager.areNotificationsEnabled()) return;
        if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        cancel(account, message);
        // Bound persisted routes even after the user dismisses notifications in Android.
        var routes = preferences.getAll().keySet().stream().filter(k -> k.startsWith("route.")).collect(java.util.stream.Collectors.toList());
        if (routes.size() >= 64) for (String key : routes) removeRoute(key);
        String token = UUID.randomUUID().toString();
        JSONObject route = new JSONObject().put("accountId", account).put("messageId", message);
        preferences.edit().putString("route." + token, route.toString()).apply();
        Intent intent = new Intent(activity, MainActivity.class).setAction(OPEN)
            .setData(new Uri.Builder().scheme("zoomerlip-notification").authority(token).build())
            .putExtra(TOKEN, token).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent open = PendingIntent.getActivity(activity, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String channel = sound ? MESSAGES : QUIET;
        Notification publicVersion = new Notification.Builder(activity, channel).setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("Zoomerlip").setContentText("New message").build();
        Notification notification = new Notification.Builder(activity, channel).setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(title.substring(0, Math.min(title.length(), 100)))
            .setContentText(body.substring(0, Math.min(body.length(), 180)))
            .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(publicVersion)
            .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true).build();
        manager.notify(tag(account, message), 0, notification);
    }
    private void removeRoute(String key) {
        try { JSONObject route = new JSONObject(preferences.getString(key, "{}")); manager.cancel(tag(route.getString("accountId"), route.getLong("messageId")), 0); } catch (Exception ignored) { }
        preferences.edit().remove(key).apply();
    }
    void cancel(String account, long message) {
        manager.cancel(tag(account, message), 0);
        for (String key : preferences.getAll().keySet()) if (key.startsWith("route.")) {
            try { JSONObject route = new JSONObject(preferences.getString(key, "{}")); if (route.optString("accountId").equals(account) && route.optLong("messageId") == message) preferences.edit().remove(key).apply(); } catch (Exception ignored) { preferences.edit().remove(key).apply(); }
        }
    }
    void clear(String account) {
        for (var notification : manager.getActiveNotifications()) if (notification.getTag() != null && notification.getTag().startsWith(tag(account, 0).replace(":0", ":"))) manager.cancel(notification.getTag(), notification.getId());
        for (String key : preferences.getAll().keySet()) if (key.startsWith("route.")) {
            try { if (new JSONObject(preferences.getString(key, "{}")).optString("accountId").equals(account)) preferences.edit().remove(key).apply(); } catch (Exception ignored) { preferences.edit().remove(key).apply(); }
        }
        if (pending != null && pending.optString("accountId").equals(account)) pending = null;
    }
    void accept(Intent intent) {
        if (intent == null || !OPEN.equals(intent.getAction())) return;
        String token = intent.getStringExtra(TOKEN); if (token == null || !token.matches("[a-f0-9-]{36}")) return;
        String key = "route." + token, raw = preferences.getString(key, null);
        preferences.edit().remove(key).apply(); intent.removeExtra(TOKEN);
        try { JSONObject route = new JSONObject(raw); if (accounts().contains(route.getString("accountId"))) pending = route; } catch (Exception ignored) { }
    }
}
