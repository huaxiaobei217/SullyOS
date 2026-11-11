package com.kythie.sullyos;

import android.content.Context;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 系统级悬浮歌词（个人二改），长得和 App 里的桌面歌词一样：
 *  - 左右各留 12dp、居中；深色半透明圆角底；当前句 + 翻译，单行省略
 *  - 点一下展开：下一句预览 + 上一首 / 播放暂停 / 下一首 / 回到音乐；再点收起
 *  - 上下拖动换位置（和 App 里的桌面歌词共用同一个位置）；锁定后点击穿透
 * 网页把整首歌的时间轴一次性给过来，之后只在播放 / 暂停 / 拖进度 / 换歌时同步位置，原生自己按时钟走。
 * 回到 App 里自动收起（App 里有自己的桌面歌词）。
 */
@CapacitorPlugin(name = "FloatingLyric")
public class FloatingLyricPlugin extends Plugin {
    private static class Line { long t; String text; String tr; }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Line> lines = new ArrayList<>();
    private String title = "";
    private long basePosMs = 0, baseClock = 0;
    private boolean playing = false, enabled = false, inBackground = false, expanded = false;
    private float fontScale = 1f, opacity = 0.42f, topPct = 0.08f;
    private boolean locked = false;

    private WindowManager wm;
    private LinearLayout box, controls;
    private TextView mainTv, subTv, nextTv;
    private IconView playBtn;
    private WindowManager.LayoutParams lp;
    private int lastIdx = -2;
    private boolean lastPlaying = false;

    private final Runnable tick = new Runnable() {
        @Override public void run() { render(false); if (box != null) main.postDelayed(this, 250); }
    };

    private boolean canDraw() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext());
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject r = new JSObject(); r.put("granted", canDraw()); call.resolve(r);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (!canDraw()) {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        JSObject r = new JSObject(); r.put("granted", canDraw()); call.resolve(r);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        final String before = fontScale + "|" + opacity + "|" + topPct + "|" + locked;
        enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Double fs = call.getDouble("fontScale"); if (fs != null && fs > 0.5 && fs < 2.5) fontScale = fs.floatValue();
        Double op = call.getDouble("opacity"); if (op != null && op >= 0 && op <= 1) opacity = op.floatValue();
        Double tp = call.getDouble("topPct"); if (tp != null && tp >= 0 && tp <= 1) topPct = tp.floatValue();
        locked = Boolean.TRUE.equals(call.getBoolean("locked", false));
        final boolean restyle = !before.equals(fontScale + "|" + opacity + "|" + topPct + "|" + locked);
        main.post(() -> { if (box != null && restyle) removeBox(); refreshVisibility(); });
        call.resolve();
    }

    @PluginMethod
    public void setLyrics(PluginCall call) {
        final List<Line> next = new ArrayList<>();
        JSArray arr = call.getArray("lines");
        try {
            if (arr != null) for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Line l = new Line();
                l.t = (long) (o.optDouble("t", 0) * 1000);
                l.text = o.optString("text", "");
                l.tr = o.optString("tr", "");
                next.add(l);
            }
        } catch (Exception ignored) { }
        final String t = call.getString("title", "");
        main.post(() -> { lines.clear(); lines.addAll(next); title = t; render(true); refreshVisibility(); });
        call.resolve();
    }

    @PluginMethod
    public void sync(PluginCall call) {
        final double pos = call.getDouble("position", 0.0);
        final boolean p = Boolean.TRUE.equals(call.getBoolean("playing", false));
        main.post(() -> { basePosMs = (long) (pos * 1000); baseClock = SystemClock.elapsedRealtime(); playing = p; refreshVisibility(); render(true); });
        call.resolve();
    }

    @Override protected void handleOnPause() { inBackground = true; main.post(this::refreshVisibility); }
    @Override protected void handleOnResume() { inBackground = false; main.post(this::refreshVisibility); }
    @Override protected void handleOnDestroy() { main.post(this::removeBox); }

    private void refreshVisibility() {
        boolean want = enabled && inBackground && canDraw() && (!lines.isEmpty() || !title.isEmpty());
        if (want && box == null) addBox();
        else if (!want && box != null) removeBox();
    }

    private long posNow() { return playing ? basePosMs + (SystemClock.elapsedRealtime() - baseClock) : basePosMs; }

    private void render(boolean force) {
        if (box == null) return;
        int idx = -1;
        long p = posNow();
        for (int i = 0; i < lines.size(); i++) { if (lines.get(i).t <= p + 150) idx = i; else break; }
        if (!force && idx == lastIdx && playing == lastPlaying) return;
        lastIdx = idx; lastPlaying = playing;
        Line cur = idx >= 0 ? lines.get(idx) : null;
        String mainText, sub;
        if (playing && cur != null && !cur.text.isEmpty()) { mainText = cur.text; sub = cur.tr == null ? "" : cur.tr; }
        else { mainText = title.isEmpty() ? "♪" : title; sub = playing ? "" : "已暂停"; }
        mainTv.setText(mainText);
        subTv.setText(sub);
        subTv.setVisibility(sub.isEmpty() ? View.GONE : View.VISIBLE);
        Line nx = idx + 1 < lines.size() ? lines.get(Math.max(0, idx + 1)) : null;
        String nextText = playing && nx != null ? nx.text : "";
        nextTv.setText(nextText);
        nextTv.setVisibility(expanded && !nextText.isEmpty() ? View.VISIBLE : View.GONE);
        controls.setVisibility(expanded ? View.VISIBLE : View.GONE);
        playBtn.setKind(playing ? IconView.PAUSE : IconView.PLAY);
    }

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getContext().getResources().getDisplayMetrics());
    }

    private int statusBarHeight() {
        int id = getContext().getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? getContext().getResources().getDimensionPixelSize(id) : dp(24);
    }

    /** 整块屏幕的真实大小（含状态栏、导航栏），不是 App 窗口那块 */
    private int[] screenSize() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && wm != null) {
                android.graphics.Rect b = wm.getCurrentWindowMetrics().getBounds();
                return new int[] { b.width(), b.height() };
            }
        } catch (Exception ignored) { }
        DisplayMetrics dm = new DisplayMetrics();
        try { if (wm != null) { wm.getDefaultDisplay().getRealMetrics(dm); return new int[] { dm.widthPixels, dm.heightPixels }; } } catch (Exception ignored) { }
        dm = getContext().getResources().getDisplayMetrics();
        return new int[] { dm.widthPixels, dm.heightPixels };
    }

    /** 0 = 紧贴状态栏下面，1 = 离屏幕底部 120dp。窗口不吃系统栏的边距，y 就是从屏幕最顶上量 */
    private int yForPct(float pct) {
        int top = statusBarHeight() + dp(2);
        int span = Math.max(1, screenSize()[1] - top - dp(120));
        return top + (int) (span * pct);
    }

    private float pctForY(int y) {
        int top = statusBarHeight() + dp(2);
        int span = Math.max(1, screenSize()[1] - top - dp(120));
        return Math.max(0f, Math.min(1f, (y - top) / (float) span));
    }

    private TextView text(Context ctx, float sp, int alpha, boolean bold) {
        TextView tv = new TextView(ctx);
        tv.setTextColor(Color.argb(alpha, 255, 255, 255));
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        tv.setGravity(Gravity.CENTER);
        tv.setShadowLayer(3f, 0f, 1f, Color.argb(115, 0, 0, 0));
        tv.setSingleLine(true);
        tv.setEllipsize(TextUtils.TruncateAt.END);
        if (bold) tv.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return tv;
    }

    private void emit(String action) {
        JSObject o = new JSObject(); o.put("action", action);
        notifyListeners("control", o);
    }

    private void addBox() {
        Context ctx = getContext().getApplicationContext();
        wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        DisplayMetrics dm = ctx.getResources().getDisplayMetrics();

        box = new LinearLayout(ctx);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(dp(12), dp(6), dp(12), dp(6));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(Math.round(opacity * 255), 15, 23, 42));
        bg.setCornerRadius(dp(16));
        box.setBackground(bg);

        mainTv = text(ctx, 15f * fontScale, 255, true);
        subTv = text(ctx, 11.5f * fontScale, 205, false);
        nextTv = text(ctx, 12f, 150, false);
        nextTv.setPadding(0, dp(2), 0, 0);
        box.addView(mainTv, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        box.addView(subTv, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        box.addView(nextTv, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        controls = new LinearLayout(ctx);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER);
        controls.setPadding(0, dp(6), 0, dp(2));
        IconView prev = new IconView(ctx, IconView.PREV, false);
        playBtn = new IconView(ctx, IconView.PLAY, true);
        IconView nextB = new IconView(ctx, IconView.NEXT, false);
        IconView open = new IconView(ctx, IconView.NOTE, false);
        prev.setOnClickListener(v -> emit("prev"));
        playBtn.setOnClickListener(v -> { playing = !playing; baseClock = SystemClock.elapsedRealtime(); render(true); emit("toggle"); });
        nextB.setOnClickListener(v -> emit("next"));
        open.setOnClickListener(v -> {
            emit("open");
            Intent i = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            if (i != null) { i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT); ctx.startActivity(i); }
        });
        int s = dp(34), ps = dp(32), gap = dp(12);
        LinearLayout.LayoutParams a = new LinearLayout.LayoutParams(s, s); a.setMargins(gap, 0, gap, 0);
        LinearLayout.LayoutParams b = new LinearLayout.LayoutParams(ps, ps); b.setMargins(gap, 0, gap, 0);
        LinearLayout.LayoutParams c = new LinearLayout.LayoutParams(s, s); c.setMargins(gap, 0, gap, 0);
        LinearLayout.LayoutParams d = new LinearLayout.LayoutParams(s, s); d.setMargins(gap, 0, gap, 0);
        controls.addView(prev, a); controls.addView(playBtn, b); controls.addView(nextB, c); controls.addView(open, d);
        box.addView(controls, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
        int flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN;
        if (locked) flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        lp = new WindowManager.LayoutParams(screenSize()[0] - dp(16), WindowManager.LayoutParams.WRAP_CONTENT, type, flags, PixelFormat.TRANSLUCENT);
        // 安卓 11+ 悬浮窗默认会让开状态栏 / 刘海，再加上我们自己算的状态栏高度，就被挤到中上部了：这里关掉让位，自己算
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) { lp.setFitInsetsTypes(0); lp.setFitInsetsSides(0); }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        lp.x = 0;
        lp.y = yForPct(topPct);

        box.setOnTouchListener(new View.OnTouchListener() {
            float downY; int startY; boolean moved;
            @Override public boolean onTouch(View v, MotionEvent e) {
                switch (e.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        downY = e.getRawY(); startY = lp.y; moved = false; return true;
                    case MotionEvent.ACTION_MOVE:
                        float dy = e.getRawY() - downY;
                        if (!moved && Math.abs(dy) < dp(6)) return true;
                        moved = true;
                        lp.y = Math.max(statusBarHeight(), Math.min(screenSize()[1] - dp(60), (int) (startY + dy)));
                        try { wm.updateViewLayout(box, lp); } catch (Exception ignored) { }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (moved) {
                            topPct = pctForY(lp.y);
                            JSObject o = new JSObject(); o.put("action", "moved"); o.put("topPct", topPct);
                            notifyListeners("control", o);
                        } else { expanded = !expanded; render(true); }
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        return true;
                }
                return false;
            }
        });

        try { wm.addView(box, lp); } catch (Exception e) { box = null; return; }
        render(true);
        main.removeCallbacks(tick);
        main.post(tick);
    }

    private void removeBox() {
        main.removeCallbacks(tick);
        if (box != null && wm != null) { try { wm.removeView(box); } catch (Exception ignored) { } }
        box = null; expanded = false;
    }

    /** 简单的矢量小图标（不用 emoji，免得各家系统画成彩色的） */
    static class IconView extends View {
        static final int PREV = 0, PLAY = 1, PAUSE = 2, NEXT = 3, NOTE = 4;
        private int kind;
        private final boolean filledCircle;
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        IconView(Context c, int kind, boolean filledCircle) { super(c); this.kind = kind; this.filledCircle = filledCircle; setClickable(true); }
        void setKind(int k) { if (k != kind) { kind = k; invalidate(); } }
        @Override protected void onDraw(Canvas cv) {
            float w = getWidth(), h = getHeight(), cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2;
            int fg = Color.WHITE;
            if (filledCircle) { p.setStyle(Paint.Style.FILL); p.setColor(Color.argb(230, 255, 255, 255)); cv.drawCircle(cx, cy, r, p); fg = Color.rgb(15, 23, 42); }
            p.setColor(fg); p.setStyle(Paint.Style.FILL);
            float u = r * 0.42f;
            Path path = new Path();
            switch (kind) {
                case PLAY:
                    path.moveTo(cx - u * 0.6f, cy - u); path.lineTo(cx + u * 0.9f, cy); path.lineTo(cx - u * 0.6f, cy + u); path.close(); cv.drawPath(path, p); break;
                case PAUSE:
                    cv.drawRoundRect(cx - u * 0.75f, cy - u, cx - u * 0.2f, cy + u, 2, 2, p);
                    cv.drawRoundRect(cx + u * 0.2f, cy - u, cx + u * 0.75f, cy + u, 2, 2, p); break;
                case PREV:
                    cv.drawRect(cx - u, cy - u, cx - u * 0.72f, cy + u, p);
                    path.moveTo(cx + u, cy - u); path.lineTo(cx - u * 0.6f, cy); path.lineTo(cx + u, cy + u); path.close(); cv.drawPath(path, p); break;
                case NEXT:
                    cv.drawRect(cx + u * 0.72f, cy - u, cx + u, cy + u, p);
                    path.moveTo(cx - u, cy - u); path.lineTo(cx + u * 0.6f, cy); path.lineTo(cx - u, cy + u); path.close(); cv.drawPath(path, p); break;
                case NOTE:
                    p.setAlpha(200);
                    cv.drawCircle(cx - u * 0.45f, cy + u * 0.6f, u * 0.42f, p);
                    cv.drawRect(cx - u * 0.12f, cy - u, cx + u * 0.08f, cy + u * 0.6f, p);
                    path.moveTo(cx - u * 0.12f, cy - u); path.lineTo(cx + u * 0.8f, cy - u * 0.6f); path.lineTo(cx + u * 0.8f, cy - u * 0.25f); path.lineTo(cx - u * 0.12f, cy - u * 0.62f); path.close();
                    cv.drawPath(path, p); break;
            }
        }
    }
}
