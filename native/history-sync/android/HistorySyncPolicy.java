package app.outpost.historysync;

public final class HistorySyncPolicy {

  public static final long MAX_RUN_MS = 30 * 60 * 1000L;
  public static final long MAX_SILENCE_MS = 90000;

  private HistorySyncPolicy() {}

  public static boolean validId(String id) {
    return id != null && id.matches("[a-f0-9]{32,64}");
  }

  public static int count(double value) {
    return Double.isFinite(value) ? (int) Math.max(0, Math.min(1000, value)) : 0;
  }

  public static String expired(long started, long heartbeat, long now) {
    if (now < started || now < heartbeat) return "CLOCK_CHANGED";
    if (now - started >= MAX_RUN_MS) return "TIME_LIMIT";
    if (now - heartbeat >= MAX_SILENCE_MS) return "WORKER_STALLED";
    return null;
  }
}
