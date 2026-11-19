package me.kirancodes.zoomerlip;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class FileChooserPolicyTest {
    @Test public void attachmentTypesIncludeDocumentsVideoAudioAndImages() {
        assertArrayEquals(new String[]{"application/pdf", "video/*", "audio/*", "image/*"}, FileChooserPolicy.mimeTypes(new String[]{"application/pdf, video/*", "audio/*", "image/*"}));
        assertArrayEquals(new String[]{"*/*"}, FileChooserPolicy.mimeTypes(new String[]{""}));
        assertArrayEquals(new String[]{"application/json"}, FileChooserPolicy.mimeTypes(new String[]{".json"}));
    }
    @Test public void selectionRejectsFileNetworkNullAndOversizedResults() {
        for (String uri : new String[]{"file:///data/private", "https://evil.test/file"}) assertNull(FileChooserPolicy.selected(new Intent().setData(Uri.parse(uri)), false));
        assertNull(FileChooserPolicy.selected(null, false));
        ClipData clips = ClipData.newRawUri("first", Uri.parse("content://picker/1"));
        clips.addItem(new ClipData.Item(Uri.parse("content://picker/2")));
        Intent data = new Intent(); data.setClipData(clips);
        assertEquals(2, FileChooserPolicy.selected(data, true).length);
        assertNull(FileChooserPolicy.selected(data, false));
        for (int i = 0; i < 20; i++) clips.addItem(new ClipData.Item(Uri.parse("content://picker/" + i)));
        assertNull(FileChooserPolicy.selected(data, true));
    }
}
