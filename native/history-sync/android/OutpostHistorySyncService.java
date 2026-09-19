package app.outpost.historysync;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.*;
import com.facebook.react.HeadlessJsTaskService;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.jstasks.HeadlessJsTaskConfig;

public final class OutpostHistorySyncService extends HeadlessJsTaskService {

  static final String START = "app.outpost.historysync.START",
    STOP = "app.outpost.historysync.STOP";
  static final String CHANNEL = "outpost-history-sync-v1";
  static final int NOTIFICATION_ID = 9203;
  static final long MAX_RUN_MS = HistorySyncPolicy.MAX_RUN_MS;
  static OutpostHistorySyncService instance;
  String runId;
  boolean ready = false,
    ended = false,
    taskStarted = false;
  long startedAt, heartbeat, lastNotice;
  int checked = 0,
    total = 0,
    conversations = 0,
    failed = 0;
  final Handler handler = new Handler(Looper.getMainLooper());

  static boolean notificationsAllowed(Context context) {
    NotificationManager manager = context.getSystemService(NotificationManager.class);
    if (manager == null || !manager.areNotificationsEnabled()) return false;
    if (
      Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
        PackageManager.PERMISSION_GRANTED
    ) return false;
    if (Build.VERSION.SDK_INT < 26) return true;
    NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
    return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String id = intent == null ? null : intent.getStringExtra("runId");
    if (intent != null && STOP.equals(intent.getAction())) {
      if (runId != null && runId.equals(id)) end("CANCELLED", true);
      else if (runId == null) stopSelf();
      return START_NOT_STICKY;
    }
    if (runId != null) return START_NOT_STICKY;
    if (
      intent == null ||
      !START.equals(intent.getAction()) ||
      !OutpostHistorySyncModule.validId(id) ||
      !id.equals(OutpostHistorySyncModule.pendingId)
    ) {
      stopSelf();
      return START_NOT_STICKY;
    }
    runId = id;
    instance = this;
    startedAt = SystemClock.elapsedRealtime();
    heartbeat = startedAt;
    try {
      if (!notificationsAllowed(this)) throw new IllegalStateException("notifications-disabled");
      if (Build.VERSION.SDK_INT >= 26) {
        NotificationChannel channel = new NotificationChannel(
          CHANNEL,
          "Chat history sync",
          NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Progress for a history sync you started");
        channel.setSound(null, null);
        channel.enableVibration(false);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
      }
      Notification notification = notification(null);
      if (Build.VERSION.SDK_INT >= 29) startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
      );
      else startForeground(NOTIFICATION_ID, notification);
      WritableMap data = Arguments.createMap();
      data.putString("runId", runId);
      taskStarted = true;
      startTask(new HeadlessJsTaskConfig("OutpostChatHistorySync", data, MAX_RUN_MS + 15000, true));
      handler.postDelayed(watchdog, 10000);
    } catch (Exception error) {
      end("START_FAILED", false);
    }
    return START_NOT_STICKY;
  }

  void touch() {
    heartbeat = SystemClock.elapsedRealtime();
  }

  void update(int checked, int total, int conversations, int failed) {
    if (ended) return;
    this.total = total;
    this.checked = Math.min(checked, total);
    this.conversations = conversations;
    this.failed = failed;
    long now = SystemClock.elapsedRealtime();
    if (now - lastNotice < 5000) return;
    lastNotice = now;
    try {
      getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(null));
    } catch (Exception error) {
      end("NOTIFICATIONS_DISABLED", false);
    }
  }

  private final Runnable watchdog = new Runnable() {
    @Override
    public void run() {
      if (ended) return;
      long now = SystemClock.elapsedRealtime();
      String reason = HistorySyncPolicy.expired(startedAt, heartbeat, now);
      if (reason != null) {
        end(reason, true);
        return;
      }
      handler.postDelayed(this, 10000);
    }
  };

  private Notification notification(String reason) {
    boolean running = reason == null;
    String title = running
      ? "Syncing Riot chat history"
      : "COMPLETE".equals(reason)
        ? "Chat history synced"
        : "CANCELLED".equals(reason)
          ? "Chat history sync stopped"
          : "Chat history sync paused";
    String text =
      checked +
      " / " +
      total +
      " friends checked - " +
      conversations +
      " conversations" +
      (failed > 0 ? " - " + failed + " failed" : "");
    if (running && !ready) text = "Preparing background sync";
    Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
    if (open != null) open.addFlags(
      Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP
    );
    Notification.Builder base =
      Build.VERSION.SDK_INT >= 26
        ? new Notification.Builder(this, CHANNEL)
        : new Notification.Builder(this);
    Notification.Builder builder = base
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle(title)
      .setContentText(text)
      .setOnlyAlertOnce(true)
      .setOngoing(running)
      .setAutoCancel(!running)
      .setCategory(Notification.CATEGORY_PROGRESS)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
      .setShowWhen(false);
    if (open != null) builder.setContentIntent(
      PendingIntent.getActivity(
        this,
        9204,
        open,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
      )
    );
    if (running) {
      builder.setProgress(Math.max(1, total), checked, total == 0);
      Intent stop = new Intent(this, OutpostHistorySyncService.class)
        .setAction(STOP)
        .setData(Uri.parse("outpost-sync://stop/" + runId))
        .putExtra("runId", runId);
      builder.addAction(
        new Notification.Action.Builder(
          null,
          "Stop",
          PendingIntent.getService(
            this,
            9205,
            stop,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
          )
        ).build()
      );
      if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(
        Notification.FOREGROUND_SERVICE_IMMEDIATE
      );
    }
    return builder.build();
  }

  void end(String reason, boolean showResult) {
    if (ended) return;
    ended = true;
    ready = false;
    handler.removeCallbacksAndMessages(null);
    if (runId != null) {
      OutpostHistorySyncModule.failStart(runId, "SYNC_" + reason);
      OutpostHistorySyncModule.event(runId, reason);
    }
    try {
      stopForeground(STOP_FOREGROUND_REMOVE);
    } catch (Exception ignored) {}
    if (showResult && notificationsAllowed(this)) {
      try {
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(reason));
      } catch (Exception ignored) {}
    }
    stopSelf();
  }

  @Override
  public void onTimeout(int startId, int fgsType) {
    end("OS_TIMEOUT", true);
  }

  @Override
  public void onTaskRemoved(Intent rootIntent) {
    end("CANCELLED", false);
  }

  @Override
  public void onHeadlessJsTaskFinish(int taskId) {
    super.onHeadlessJsTaskFinish(taskId);
  }

  @Override
  public void onDestroy() {
    if (!ended && runId != null) end("RUNTIME_STOPPED", false);
    handler.removeCallbacksAndMessages(null);

    if (taskStarted) super.onDestroy();
    if (instance == this) instance = null;
  }
}
