package com.custdb.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.Window;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

/**
 * 通信客户资料库 · 安卓壳
 *
 * 通过 WebView 加载 NAS 上的服务端应用（http://NAS:端口/app/custdb 或
 * https://隧道域名/app/custdb）。首次启动可填写/修改服务器地址，之后
 * 自动保存并直连。所有数据仍存储在 NAS 服务端（同一份数据，电脑手机互通）。
 */
public class MainActivity extends Activity {

    private static final String PREFS = "custdb_prefs";
    private static final String KEY_URL = "server_url";
    private static final String DEFAULT_URL = "http://192.168.1.100:5001/app/custdb";

    private WebView webView;
    private ProgressBar progressBar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgress(0);
        root.addView(progressBar, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 6));

        webView = new WebView(this);
        webView.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.MATCH_PARENT));
        root.addView(webView);

        setContentView(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progressBar.setVisibility(View.VISIBLE);
                progressBar.setProgress(10);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setProgress(100);
                progressBar.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                progressBar.setVisibility(View.GONE);
                Toast.makeText(MainActivity.this,
                        "无法连接服务器：请检查地址与网络\n" + failingUrl, Toast.LENGTH_LONG).show();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
            }
        });

        loadServerUrl(false);
    }

    private void loadServerUrl(boolean forcePrompt) {
        String url = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, "");
        if (url.isEmpty() || forcePrompt) {
            promptServerUrl(forcePrompt);
        } else {
            webView.loadUrl(url);
        }
    }

    /** 首次启动 / 菜单「修改服务器地址」：弹窗填写地址 */
    private void promptServerUrl(boolean edit) {
        String current = getSharedPreferences(PREFS, MODE_PRIVATE)
                .getString(KEY_URL, DEFAULT_URL);
        if (current.isEmpty()) current = DEFAULT_URL;

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad, pad, pad);
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setText(current);
        box.addView(input);

        new AlertDialog.Builder(this)
                .setTitle(edit ? "修改服务器地址" : "首次使用：设置服务器地址")
                .setMessage("填写 NAS 上通信客户资料库的访问地址，例如：\n" +
                        "http://192.168.1.100:5001/app/custdb\n" +
                        "或 https://你的隧道域名/app/custdb\n" +
                        "（地址需以 /app/custdb 结尾）")
                .setView(box)
                .setCancelable(false)
                .setPositiveButton("连接", (d, w) -> {
                    String url = input.getText().toString().trim();
                    if (url.isEmpty()) {
                        Toast.makeText(this, "地址不能为空", Toast.LENGTH_SHORT).show();
                        loadServerUrl(true);
                        return;
                    }
                    if (!url.startsWith("http://") && !url.startsWith("https://")) {
                        url = "http://" + url;
                    }
                    getSharedPreferences(PREFS, MODE_PRIVATE)
                            .edit().putString(KEY_URL, url).apply();
                    webView.loadUrl(url);
                })
                .setNegativeButton(edit ? "取消" : "退出", (d, w) -> {
                    if (edit) {
                        // 保留旧地址继续浏览
                        String old = getSharedPreferences(PREFS, MODE_PRIVATE)
                                .getString(KEY_URL, "");
                        if (!old.isEmpty()) webView.loadUrl(old);
                    } else {
                        finish();
                    }
                })
                .show();
    }

    /** 物理返回键：优先回退网页历史 */
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        super.onDestroy();
    }
}
