"""Policy unit tests with synthetic landmarks; these are NOT real camera acceptance."""
import unittest
from engine import action_passed


class ActionPolicyTest(unittest.TestCase):
    def test_action_and_return_required(self) -> None:
        front = (0.05, 0.05, 0.0)
        closed = (0.8, 0.8, 0.0)
        left = (0.05, 0.05, 0.2)
        right = (0.05, 0.05, -0.2)
        for action, sample in [('blink', closed), ('turn_left', left), ('turn_right', right)]:
            with self.subTest(action=action):
                self.assertTrue(action_passed([front, sample, sample, front], action))
                self.assertFalse(action_passed([front] * 11, action))
                self.assertFalse(action_passed([front, sample, sample, sample], action))
                self.assertFalse(action_passed([sample, sample, front, front], action))
        self.assertFalse(action_passed([front, right, right, front], 'turn_left'))
        self.assertFalse(action_passed([front, left, left, front], 'turn_right'))
        self.assertFalse(action_passed([front, (0.9, 0.1, 0), front, front], 'blink'))
        self.assertFalse(action_passed([front] * 3, 'blink'))
        self.assertFalse(action_passed([front] * 4, 'unknown'))


if __name__ == '__main__':
    unittest.main()
