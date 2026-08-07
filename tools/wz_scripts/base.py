import os


def remove_attributes(node, attributes):
    for attribute in attributes:
        node.attrib.pop(attribute, None)
    for child in node:
        remove_attributes(child, attributes)


def traverse_directory(in_path, out_path, callback=None):
    for item in sorted(os.listdir(in_path)):
        in_item_path = os.path.join(in_path, item)
        out_item_path = os.path.join(out_path, item)
        if os.path.isdir(in_item_path):
            traverse_directory(in_item_path, out_item_path, callback)
        elif callback:
            callback(in_item_path, out_item_path)


def prepare_directory(filename):
    parts = filename.split(os.sep)
    directory = os.sep.join(parts[:-1])
    os.makedirs(directory, exist_ok=True)
