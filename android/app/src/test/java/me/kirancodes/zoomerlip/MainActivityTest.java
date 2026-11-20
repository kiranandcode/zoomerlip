package me.kirancodes.zoomerlip;

import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.ComponentName;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class MainActivityTest {
    @Test public void credentialViewLoadsOnlyBundledEntryWithRestrictedSettings() throws Exception {
        try (var controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            FrameLayout content = activity.findViewById(android.R.id.content);
            FrameLayout root = (FrameLayout) content.getChildAt(0);
            WebView web = (WebView) root.getChildAt(0);
            assertEquals(NavigationPolicy.START, web.getUrl());
            WebSettings settings = web.getSettings();
            assertTrue(settings.getJavaScriptEnabled());
            assertTrue(settings.getDomStorageEnabled());
            assertFalse(settings.getAllowFileAccess());
            assertFalse(settings.getAllowFileAccessFromFileURLs());
            assertFalse(settings.getAllowUniversalAccessFromFileURLs());
            assertFalse(settings.getJavaScriptCanOpenWindowsAutomatically());
            assertEquals(WebSettings.MIXED_CONTENT_NEVER_ALLOW, settings.getMixedContentMode());
            assertFalse(CookieManager.getInstance().acceptCookie());
            assertEquals(0, activity.getApplicationInfo().flags & ApplicationInfo.FLAG_ALLOW_BACKUP);
            ActivityInfo info = activity.getPackageManager().getActivityInfo(new ComponentName(activity, MainActivity.class), 0);
            int required = ActivityInfo.CONFIG_ORIENTATION | ActivityInfo.CONFIG_SCREEN_SIZE | ActivityInfo.CONFIG_UI_MODE | ActivityInfo.CONFIG_KEYBOARD_HIDDEN;
            assertEquals(required, info.configChanges & required);
        }
    }
    @Test public void rotationRetainsCredentialWebViewAndKeyboardInsetsAvoidOverlap() {
        try (var controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity activity = controller.get();
            FrameLayout content = activity.findViewById(android.R.id.content);
            FrameLayout root = (FrameLayout) content.getChildAt(0);
            WebView web = (WebView) root.getChildAt(0);
            android.content.res.Configuration config = new android.content.res.Configuration(activity.getResources().getConfiguration());
            config.orientation = android.content.res.Configuration.ORIENTATION_LANDSCAPE;
            controller.configurationChange(config);
            assertSame(activity, controller.get());
            assertSame(web, root.getChildAt(0));
            android.view.WindowInsets insets = new android.view.WindowInsets.Builder()
                .setInsets(android.view.WindowInsets.Type.systemBars(), android.graphics.Insets.of(4, 20, 4, 24))
                .setInsets(android.view.WindowInsets.Type.ime(), android.graphics.Insets.of(0, 0, 0, 260)).build();
            root.dispatchApplyWindowInsets(insets);
            // Repeated keyboard sizes must replace padding, never accumulate it.
            root.dispatchApplyWindowInsets(insets);
            assertEquals(260, root.getPaddingBottom());
            android.view.WindowInsets hidden = new android.view.WindowInsets.Builder()
                .setInsets(android.view.WindowInsets.Type.systemBars(), android.graphics.Insets.of(4, 20, 4, 24))
                .setInsets(android.view.WindowInsets.Type.ime(), android.graphics.Insets.NONE).build();
            root.dispatchApplyWindowInsets(hidden);
            assertEquals(24, root.getPaddingBottom());
            assertSame(web, root.getChildAt(0));
            assertEquals(20, root.getPaddingTop());
            activity.onBackPressed();
            String back = org.robolectric.Shadows.shadowOf(web).getLastEvaluatedJavascript();
            assertTrue(back.contains("dialog[open]"));
            assertTrue(back.contains("zoomerlip-home"));
            assertTrue(back.contains("Close channels"));
        }
    }
}
