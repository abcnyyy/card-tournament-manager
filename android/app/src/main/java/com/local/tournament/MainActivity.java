package com.local.tournament;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 安卓外壳：
 *   1) 给页面注册 TmsNative 桥 —— 导出 CSV / JSON / 名单时走系统「保存到」选择器；
 *   2) 导出 PDF 时调系统打印面板（可选「另存为 PDF」）。
 */
public class MainActivity extends BridgeActivity {

    private static final int REQ_SAVE = 4701;

    private String pendingContent = null;
    private byte[] pendingBinary = null;
    private String pendingMime = "text/plain";
    private String pendingName = "导出.txt";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            WebView wv = getBridge().getWebView();
            wv.addJavascriptInterface(new NativeBridge(), "TmsNative");
        } catch (Exception e) {
            // 桥注册失败时页面会自动退回浏览器下载方式
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_SAVE) return;
        try {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri uri = data.getData();
                if (pendingBinary != null) {
                    OutputStream ob = getContentResolver().openOutputStream(uri, "w");
                    if (ob != null) {
                        ob.write(pendingBinary);
                        ob.flush();
                        ob.close();
                        toast("已保存：" + pendingName);
                    } else {
                        toast("保存失败：无法写入该位置");
                    }
                } else {
                    OutputStream os = getContentResolver().openOutputStream(uri, "wt");
                    if (os != null) {
                        String body = pendingContent == null ? "" : pendingContent;
                        os.write(body.getBytes(StandardCharsets.UTF_8));
                        os.flush();
                        os.close();
                        toast("已保存：" + pendingName);
                    } else {
                        toast("保存失败：无法写入该位置");
                    }
                }
            } else {
                toast("已取消导出");
            }
        } catch (Exception e) {
            toast("保存失败：" + e.getMessage());
        } finally {
            pendingContent = null;
            pendingBinary = null;
        }
    }

    private void toast(final String msg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
            }
        });
    }

    /** 页面里通过 window.TmsNative 调用 */
    public class NativeBridge {

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        /** 弹出系统「保存到」选择器，用户选好目录后写入 */
        @JavascriptInterface
        public void saveFile(final String filename, final String content, final String mime) {
            pendingName = (filename == null || filename.trim().isEmpty()) ? "导出.txt" : filename.trim();
            pendingContent = content == null ? "" : content;
            pendingMime = (mime == null || mime.trim().isEmpty()) ? "text/plain" : mime;

            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        String base = pendingMime.split(";")[0].trim();
                        if (base.isEmpty()) base = "text/plain";
                        Intent it = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                        it.addCategory(Intent.CATEGORY_OPENABLE);
                        it.setType(base);
                        it.putExtra(Intent.EXTRA_TITLE, pendingName);
                        startActivityForResult(it, REQ_SAVE);
                    } catch (Exception e) {
                        toast("打开保存窗口失败：" + e.getMessage());
                    }
                }
            });
        }

        /** 系统打印面板（可「另存为 PDF」） */
        @JavascriptInterface
        public void printPage() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        WebView wv = getBridge().getWebView();
                        PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                        String job = "赛事编排系统";
                        PrintDocumentAdapter adapter;
                        if (android.os.Build.VERSION.SDK_INT >= 21) {
                            adapter = wv.createPrintDocumentAdapter(job);
                        } else {
                            adapter = wv.createPrintDocumentAdapter();
                        }
                        PrintAttributes attrs = new PrintAttributes.Builder()
                                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                .build();
                        pm.print(job, adapter, attrs);
                    } catch (Exception e) {
                        toast("打开打印失败：" + e.getMessage());
                    }
                }
            });
        }

        /**
         * 保存二进制文件（JPG / PDF）：页面传 base64，这里解码后写入用户选的位置。
         * 全程不经过系统打印面板 —— 点一下就出文件。
         */
        @JavascriptInterface
        public void saveBase64(final String filename, final String base64, final String mime) {
            pendingName = (filename == null || filename.trim().isEmpty()) ? "导出.jpg" : filename.trim();
            pendingMime = (mime == null || mime.trim().isEmpty()) ? "application/octet-stream" : mime;
            try {
                pendingBinary = android.util.Base64.decode(base64 == null ? "" : base64,
                        android.util.Base64.DEFAULT);
            } catch (Exception e) {
                pendingBinary = null;
                toast("图片编码失败：" + e.getMessage());
                return;
            }
            pendingContent = null;

            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        String base = pendingMime.split(";")[0].trim();
                        if (base.isEmpty()) base = "application/octet-stream";
                        Intent it = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                        it.addCategory(Intent.CATEGORY_OPENABLE);
                        it.setType(base);
                        it.putExtra(Intent.EXTRA_TITLE, pendingName);
                        startActivityForResult(it, REQ_SAVE);
                    } catch (Exception e) {
                        toast("打开保存窗口失败：" + e.getMessage());
                    }
                }
            });
        }

        /** 安卓没有「直接存 PDF」的接口，统一走打印面板 */
        @JavascriptInterface
        public void savePDF(final String filename) {
            printPage();
        }

        @JavascriptInterface
        public String appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }
    }
}
