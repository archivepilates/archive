"""C/D-only adapter for the reviewed full-class upload and caption protocols."""
import importlib.util
from pathlib import Path
import sys


ROOT = Path.home() / 'Library/Application Support/ARCHIVE PILATES/lesson-videos-261025'
FILES = {
    'c-minjin': ('#9 민진 바렐 C.m4v', 'C', '민진', '배민진', '바렐 + 스틱'),
    'd-minjin': ('#9 민진 바렐 D.m4v', 'D', '민진', '배민진', '바렐 + 스틱'),
    'c-eunyeong': ('#9 은영 리포머 C.m4v', 'C', '은영', '정은영', '리포머 + 블럭'),
    'd-eunyeong': ('#9 은영 리포머 D.m4v', 'D', '은영', '정은영', '리포머 + 블럭'),
}


def load(filename):
    spec = importlib.util.spec_from_file_location(filename.replace('-', '_'), Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def configure(module):
    original_metadata = module.metadata
    module.ROOT = ROOT
    module.FILES = dict(FILES)

    def metadata(key):
        result = original_metadata(key)
        result['title'] = result['title'].replace('261024', '261025')
        result['description'] = result['description'].replace('2026년 10월 24일', '2026년 10월 25일')
        return result

    module.metadata = metadata
    return module


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ''
    if action == 'serve-captions':
        captions = load('serve-lesson-261024-captions.py')
        configure(captions.lesson)
        original_japanese = captions.japanese

        def japanese(key):
            result = original_japanese(key)
            result['title'] = result['title'].replace('261024', '261025')
            result['description'] = result['description'].replace('2026年10月24日', '2026年10月25日')
            return result

        captions.japanese = japanese
        sys.argv = [sys.argv[0], *sys.argv[2:]]
        captions.main()
    elif action == 'transcribe':
        if len(sys.argv) != 2:
            raise RuntimeError('transcribe_has_no_extra_arguments')
        transcriber = load('transcribe-lesson-261024.py')
        transcriber.ROOT = ROOT
        transcriber.main()
    else:
        configure(load('upload-lesson-261024.py')).main()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(type(error).__name__ + ': C/D operation stopped; inspect the private ledger before retry', flush=True)
        raise SystemExit(1)
