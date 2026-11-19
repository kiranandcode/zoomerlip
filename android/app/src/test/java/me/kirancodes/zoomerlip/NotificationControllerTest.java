package me.kirancodes.zoomerlip;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.webkit.JavaScriptReplyProxy;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class NotificationControllerTest {
    static final String ACCOUNT = "https://fixture.test|1";
    static class Reply extends JavaScriptReplyProxy {
        String last;
        java.util.List<String> messages = new java.util.ArrayList<>();
        @Override public void postMessage(String message) { last = message; messages.add(message); }
        @Override public void postMessage(byte[] message) { }
    }
    @Test public void channelsArePrivateAndPermissionIsNotRequestedAtStartup() {
        try (var controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            var manager = activity.getSystemService(NotificationManager.class);
            assertEquals(Notification.VISIBILITY_PRIVATE, manager.getNotificationChannel(NotificationController.MESSAGES).getLockscreenVisibility());
            assertNull(manager.getNotificationChannel(NotificationController.QUIET).getSound());
            assertNull(Shadows.shadowOf(activity).getLastRequestedPermission());
            NotificationController notifications = new NotificationController(activity);
            notifications.handle("{\"op\":\"permission\"}", new Reply());
            assertArrayEquals(new String[]{Manifest.permission.POST_NOTIFICATIONS}, Shadows.shadowOf(activity).getLastRequestedPermission().requestedPermissions);
        }
    }
    @Test public void navigationRequiresIssuedSingleUseTokenAndRetainedAccount() throws Exception {
        try (var controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            Shadows.shadowOf(activity.getApplication()).grantPermissions(Manifest.permission.POST_NOTIFICATIONS);
            NotificationController notifications = new NotificationController(activity);
            Reply reply = new Reply();
            notifications.handle("{\"op\":\"accounts\",\"accounts\":[\"" + ACCOUNT + "\"]}", reply);
            notifications.show(ACCOUNT, 20, "Private sender", "Private content", false);
            var manager = activity.getSystemService(NotificationManager.class);
            var posted = manager.getActiveNotifications(); assertEquals(1, posted.length);
            assertEquals(Notification.VISIBILITY_PRIVATE, posted[0].getNotification().visibility);
            assertEquals("Zoomerlip", posted[0].getNotification().publicVersion.extras.getString(Notification.EXTRA_TITLE));
            Intent click = Shadows.shadowOf(posted[0].getNotification().contentIntent).getSavedIntent();
            String token = click.getStringExtra(NotificationController.TOKEN);
            assertNotNull(token); assertFalse(click.toUri(0).contains("Private content"));
            notifications.accept(new Intent(activity, MainActivity.class).setAction(NotificationController.OPEN).putExtra(NotificationController.TOKEN, "00000000-0000-0000-0000-000000000000"));
            notifications.accept(click);
            notifications.handle("{\"op\":\"ready\"}", reply);
            assertTrue(reply.messages.stream().anyMatch(m -> m.contains("accountId") && m.contains("messageId")));
            reply.messages.clear();
            notifications.accept(new Intent(activity, MainActivity.class).setAction(NotificationController.OPEN).putExtra(NotificationController.TOKEN, token));
            notifications.handle("{\"op\":\"ready\"}", reply);
            assertFalse(reply.messages.stream().anyMatch(m -> m.contains("accountId")));
            assertFalse(activity.getSharedPreferences("notification_routes", 0).contains("route." + token));
            notifications.handle("{\"op\":\"accounts\",\"accounts\":[]}", reply);
            assertEquals(0, manager.getActiveNotifications().length);
            notifications.show(ACCOUNT, 21, "Removed", "Account", false);
            assertEquals(0, manager.getActiveNotifications().length);
        }
    }
    @Test public void accountValidationRejectsCredentialAndNavigationURLs() {
        assertTrue(NotificationController.validAccount(ACCOUNT));
        for (String bad : new String[]{"https://user:secret@fixture.test|1", "https://fixture.test/path|1", "https://fixture.test?q=secret|1", "javascript:alert(1)|1", "https://fixture.test|0"}) assertFalse(NotificationController.validAccount(bad));
    }
}
