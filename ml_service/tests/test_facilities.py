import io
import json
import unittest
from unittest.mock import patch

from ml_service.facilities import fetch_bbox


class FacilityQueryTests(unittest.TestCase):
    def test_incomplete_large_queries_split_and_require_both_complete_halves(self):
        bodies = [
            {'remark': 'timeout', 'elements': []},
            {'remark': 'timeout', 'elements': []},
            {'elements': [{'id': 1}]},
            {'elements': [{'id': 2}]},
        ]
        with patch('ml_service.facilities.time.sleep'), patch(
            'ml_service.facilities.urlopen',
            side_effect=[io.BytesIO(json.dumps(body).encode()) for body in bodies],
        ):
            result = fetch_bbox(5, 67, 6, 75)
        self.assertEqual([item['id'] for item in result['elements']], [1, 2])

    def test_unrecoverable_partial_response_is_not_a_valid_empty_snapshot(self):
        body = json.dumps({'remark': 'timeout', 'elements': []}).encode()
        with patch('ml_service.facilities.time.sleep'), patch(
            'ml_service.facilities.urlopen', side_effect=[io.BytesIO(body), io.BytesIO(body)],
        ):
            with self.assertRaises(RuntimeError):
                fetch_bbox(5, 67, 6, 71)


if __name__ == '__main__':
    unittest.main()
