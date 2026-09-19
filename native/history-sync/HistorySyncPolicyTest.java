package app.outpost.historysync;

public final class HistorySyncPolicyTest {

  static int checks = 0;

  static void check(boolean value) {
    checks++;
    if (!value) throw new AssertionError("Native policy check " + checks);
  }

  public static void main(String[] args) {
    check(!HistorySyncPolicy.validId(null));
    check(!HistorySyncPolicy.validId(""));
    check(!HistorySyncPolicy.validId("f".repeat(31)));
    check(HistorySyncPolicy.validId("a".repeat(32)));
    check(HistorySyncPolicy.validId("f".repeat(64)));
    check(!HistorySyncPolicy.validId("a".repeat(65)));
    check(!HistorySyncPolicy.validId("X".repeat(64)));
    check(!HistorySyncPolicy.validId("../" + "a".repeat(61)));
    check(HistorySyncPolicy.count(Double.NaN) == 0);
    check(HistorySyncPolicy.count(Double.POSITIVE_INFINITY) == 0);
    check(HistorySyncPolicy.count(-1) == 0);
    check(HistorySyncPolicy.count(1001) == 1000);
    check(HistorySyncPolicy.count(12.8) == 12);
    check(HistorySyncPolicy.expired(1000, 1000, 1001) == null);
    check(HistorySyncPolicy.expired(1000, 1000, 90999) == null);
    check("WORKER_STALLED".equals(HistorySyncPolicy.expired(1000, 1000, 91000)));
    check("TIME_LIMIT".equals(HistorySyncPolicy.expired(1000, 1800999, 1801000)));
    check("CLOCK_CHANGED".equals(HistorySyncPolicy.expired(1000, 1000, 999)));
    System.out.println("Native policy assertions passed: " + checks);
  }
}
