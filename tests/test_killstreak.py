from killstreak import KillStreakNotification
from constants import KILL_STREAK_NOTIFICATION_DURATION


def test_killstreak_notification_update_and_timer():
    notification = KillStreakNotification(10, "DOMINATING!", (255, 0, 0))
    assert notification.timer == KILL_STREAK_NOTIFICATION_DURATION

    assert notification.update(0.5) is True
    assert notification.timer == KILL_STREAK_NOTIFICATION_DURATION - 0.5

    assert notification.update(KILL_STREAK_NOTIFICATION_DURATION) is False
